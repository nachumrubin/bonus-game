"""Hand an image-generation prompt to ChatGPT by email, then collect the PNGs it replies with.

NOT IN USE (October 2026): ChatGPT's mail trigger couldn't generate and reply, so the
workflow went back to the user pasting prompts from docs-md/image-prompts/. Kept in case a
mail-driven generator turns up later.

Plain Python, standard library only. ChatGPT watches the studio Gmail account; a mail with
the BOOST_AVATAR_REQUEST convention below triggers it, and it replies in the same thread
with the images attached and BOOST_AVATAR_RESULT + the request ID in the reply.

Needs a Gmail app password for the studio account (to watch its inbox) (Google Account → Security → 2-Step
Verification → App passwords). Never paste it into chat or a repo file:

  setx BOOST_GMAIL_APP_PASSWORD "abcd efgh ijkl mnop"     (once; then open a new terminal)

  # send a request (prompt from a file; attachments as path=purpose)
  python image_mail.py send --character Zapi --level 5-7 --asset "concept sheet" \
      --images "1 sheet: levels 5, 6, 7 side by side" --prompt-file prompt.txt \
      --deliverables "one PNG, plain light-grey background" \
      --attach "../../assets/avatars/evolution/zapi/zapi_sheet_a_levels_1-4.png=accepted sheet A, style and identity reference"

  # wait for the reply (exits when the images are saved, or after --wait minutes)
  python image_mail.py poll <request-id> --wait 45

  python image_mail.py status [<request-id>]

The mail goes TO the studio account (its inbox is what ChatGPT and `poll` watch) and is
sent FROM a different address, nachum.a.rubin@gmail.com: ChatGPT's trigger does not fire
on a mail whose sender is the watched account itself. The sender has its own app password:

  setx BOOST_GMAIL_FROM_APP_PASSWORD "abcd efgh ijkl mnop"

Every request keeps a ledger in requests/<request-id>/ (request.json, the exact body sent,
and result/ with the returned PNGs). Statuses: SENDING → AWAITING_IMAGES → RECEIVED, or
SEND_FAILED / NEEDS_ATTENTION (a reply came back without images; its text is saved).
AWAITING_IMAGES is set only after Gmail's SMTP server accepts the message.
"""
import argparse
import datetime as dt
import email
import email.policy
import imaplib
import json
import mimetypes
import os
import re
import secrets
import smtplib
import sys
import time
from email.message import EmailMessage
from email.utils import make_msgid, formatdate

ACCOUNT = os.environ.get("BOOST_GMAIL_USER", "rubinstudio.dev@gmail.com")   # the watched inbox
HERE = os.path.dirname(os.path.abspath(__file__))
LEDGER = os.path.join(HERE, "requests")
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}


# ---------------------------------------------------------------- ledger

def ledger_dir(rid):
    return os.path.join(LEDGER, rid)


def load(rid):
    with open(os.path.join(ledger_dir(rid), "request.json"), encoding="utf-8") as f:
        return json.load(f)


def save(rec):
    os.makedirs(ledger_dir(rec["request_id"]), exist_ok=True)
    rec["updated"] = now_iso()
    with open(os.path.join(ledger_dir(rec["request_id"]), "request.json"), "w", encoding="utf-8") as f:
        json.dump(rec, f, indent=2, ensure_ascii=False)


def now_iso():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# ---------------------------------------------------------------- gmail

def password(sender=None):
    var = "BOOST_GMAIL_FROM_APP_PASSWORD" if sender and sender != ACCOUNT else "BOOST_GMAIL_APP_PASSWORD"
    pw = os.environ.get(var)
    if not pw:
        sys.exit(f"{var} is not set (see the header of this script)")
    return pw.replace(" ", "")


def imap():
    m = imaplib.IMAP4_SSL("imap.gmail.com")
    m.login(ACCOUNT, password())
    # "All Mail" has a localised name; find it by its \All special-use flag
    typ, boxes = m.list()
    name = next((re.search(rb'"([^"]+)"\s*$', b).group(1).decode() for b in boxes if rb"\All" in b), None)
    if not name:
        sys.exit("could not find Gmail's All Mail folder (is IMAP enabled for the account?)")
    m.select(f'"{name}"', readonly=True)
    return m


def gm_ids(m, uid):
    typ, data = m.uid("FETCH", uid, "(X-GM-MSGID X-GM-THRID)")
    raw = b" ".join(d if isinstance(d, bytes) else d[0] for d in data if d)
    mid = re.search(rb"X-GM-MSGID (\d+)", raw)
    thr = re.search(rb"X-GM-THRID (\d+)", raw)
    return (format(int(mid.group(1)), "x") if mid else None,
            format(int(thr.group(1)), "x") if thr else None)


def search(m, raw_query):
    typ, data = m.uid("SEARCH", "X-GM-RAW", f'"{raw_query}"')
    return data[0].split() if data and data[0] else []


def lookup_sent(rec, tries=6):
    """Find our own message in All Mail by its RFC Message-ID; record Gmail's ids."""
    m = imap()
    try:
        for _ in range(tries):
            uids = search(m, "rfc822msgid:" + rec["rfc_message_id"].strip("<>"))
            if uids:
                rec["gmail_message_id"], rec["gmail_thread_id"] = gm_ids(m, uids[-1])
                return True
            time.sleep(5)
        return False
    finally:
        m.logout()


# ---------------------------------------------------------------- send

def body_text(a, rid, attachments):
    refs = "\n".join(f"- {os.path.basename(p)}: {why}" for p, why in attachments) or "None required"
    return f"""BOOST_AVATAR_REQUEST
Request ID: {rid}
Project: Boost
Origin: Claude Code avatar 3D modeling workflow
Character: {a.character}
Evolution level: {a.level}
Asset type: {a.asset}
Revision: {a.revision}
Requested images: {a.images}

IMAGE GENERATION PROMPT
{a.prompt.strip()}

REFERENCE ATTACHMENTS
{refs}

EXPECTED DELIVERABLES
{a.deliverables.strip()}

Please generate these images and reply to this email with the original-quality PNG files attached. Include BOOST_AVATAR_RESULT and this request ID in your reply.
"""


def cmd_send(a):
    if a.prompt_file:
        with open(a.prompt_file, encoding="utf-8") as f:
            a.prompt = f.read()
    if not a.prompt or not a.prompt.strip():
        sys.exit("give --prompt or --prompt-file")
    attachments = []
    for item in a.attach:
        path, _, why = item.partition("=")
        if not os.path.isfile(path):
            sys.exit(f"attachment not found: {path}")
        attachments.append((path, why.strip() or "reference"))

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    rid = a.request_id or f"boost-{slug(a.character)}-l{slug(a.level)}-{slug(a.asset)}-{stamp}-{secrets.token_hex(2)}"
    if os.path.exists(ledger_dir(rid)):
        sys.exit(f"request {rid} already exists")

    msg = EmailMessage()
    sender = a.sender
    if sender == ACCOUNT:
        sys.exit("send from a different address than the studio account: ChatGPT's trigger ignores self-sent mail")
    if not a.dry_run:
        password(sender)                             # fail before writing a ledger
    msg["From"] = sender
    msg["To"] = ACCOUNT
    msg["Subject"] = f"BOOST_AVATAR_REQUEST | {a.character} | {a.level} | {rid}"
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(idstring=rid, domain="boost.rubinstudio")
    body = body_text(a, rid, attachments)
    msg.set_content(body)
    for path, _ in attachments:
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        main, sub = ctype.split("/", 1)
        with open(path, "rb") as f:
            msg.add_attachment(f.read(), maintype=main, subtype=sub, filename=os.path.basename(path))

    rec = {"request_id": rid, "status": "SENDING", "created": now_iso(), "account": ACCOUNT, "from": sender,
           "subject": msg["Subject"], "character": a.character, "level": a.level, "asset": a.asset,
           "revision": a.revision, "requested_images": a.images,
           "attachments": [{"file": os.path.abspath(p), "purpose": w} for p, w in attachments],
           "rfc_message_id": msg["Message-ID"], "gmail_message_id": None, "gmail_thread_id": None}
    os.makedirs(ledger_dir(rid), exist_ok=True)
    with open(os.path.join(ledger_dir(rid), "body.txt"), "w", encoding="utf-8") as f:
        f.write(body)

    if a.dry_run:
        rec["status"] = "DRY_RUN"
        save(rec)
        print(msg["Subject"])
        print(body)
        print(f"(dry run, not sent; ledger at {ledger_dir(rid)})")
        return
    save(rec)
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=120) as s:
            s.login(sender, password(sender))
            refused = s.send_message(msg)
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)
    except Exception as e:                          # never echo credentials, only the error type/text
        rec["status"], rec["error"] = "SEND_FAILED", f"{type(e).__name__}: {e}"
        save(rec)
        sys.exit(f"send failed: {rec['error']}")
    rec["status"], rec["sent"] = "AWAITING_IMAGES", now_iso()   # Gmail accepted it
    found = lookup_sent(rec)
    save(rec)
    print(f"sent {rid}")
    print(f"  status AWAITING_IMAGES  Message-ID {rec['rfc_message_id']}")
    print(f"  gmail message {rec['gmail_message_id']}  thread {rec['gmail_thread_id']}"
          + ("" if found else "  (not in All Mail yet; poll fills these in)"))


# ---------------------------------------------------------------- poll

def text_of(msg):
    part = msg.get_body(preferencelist=("plain", "html"))
    return part.get_content() if part else ""


def check_once(rec):
    """One look at the mailbox. Returns True once the images are saved."""
    m = imap()
    try:
        if not rec.get("gmail_thread_id"):
            uids = search(m, "rfc822msgid:" + rec["rfc_message_id"].strip("<>"))
            if uids:
                rec["gmail_message_id"], rec["gmail_thread_id"] = gm_ids(m, uids[-1])
        # replies in our thread, plus any separate mail quoting the request id
        uids = set()
        if rec.get("gmail_thread_id"):
            typ, data = m.uid("SEARCH", "X-GM-THRID", str(int(rec["gmail_thread_id"], 16)))
            uids |= set(data[0].split()) if data and data[0] else set()
        uids |= set(search(m, rec["request_id"]))     # filtered for BOOST_AVATAR_RESULT below
        seen = set(rec.get("seen", []))
        for uid in sorted(uids, key=int):
            mid, thr = gm_ids(m, uid)
            if mid == rec.get("gmail_message_id") or mid in seen:
                continue
            typ, data = m.uid("FETCH", uid, "(RFC822)")
            msg = email.message_from_bytes(data[0][1], policy=email.policy.default)
            if msg["Message-ID"] == rec["rfc_message_id"]:
                continue
            txt = (msg["Subject"] or "") + "\n" + text_of(msg)
            if "BOOST_AVATAR_RESULT" not in txt or rec["request_id"] not in txt:
                continue                             # an unrelated mail in the thread
            seen.add(mid)
            rec["seen"] = sorted(seen)
            out = os.path.join(ledger_dir(rec["request_id"]), "result")
            os.makedirs(out, exist_ok=True)
            saved = []
            for part in msg.iter_attachments():
                if part.get_content_type() not in IMAGE_TYPES:
                    continue
                name = os.path.basename(part.get_filename() or f"image{len(saved) + 1}.png")
                path = os.path.join(out, name)
                stem, ext = os.path.splitext(path)
                k = 1
                while os.path.exists(path):
                    path, k = f"{stem}_{k}{ext}", k + 1
                with open(path, "wb") as f:
                    f.write(part.get_payload(decode=True))
                saved.append(path)
            reply = {"gmail_message_id": mid, "rfc_message_id": msg["Message-ID"],
                     "received": msg["Date"], "files": saved}
            rec.setdefault("replies", []).append(reply)
            if saved:
                rec["status"], rec["received"] = "RECEIVED", now_iso()
                save(rec)
                print(f"RECEIVED {rec['request_id']}: {len(saved)} image(s)")
                for p in saved:
                    print("  " + p)
                return True
            note = os.path.join(out, f"reply_{mid}.txt")
            with open(note, "w", encoding="utf-8") as f:
                f.write(text_of(msg))
            rec["status"] = "NEEDS_ATTENTION"
            save(rec)
            print(f"NEEDS_ATTENTION {rec['request_id']}: reply without images, text in {note}")
            return True
        save(rec)
        return False
    finally:
        m.logout()


def cmd_poll(a):
    rec = load(a.request_id)
    if rec["status"] not in ("AWAITING_IMAGES", "NEEDS_ATTENTION"):
        sys.exit(f"{a.request_id} is {rec['status']}, nothing to poll")
    end = time.time() + a.wait * 60
    while True:
        try:
            if check_once(rec):
                return
        except (imaplib.IMAP4.error, OSError) as e:   # transient network or IMAP trouble: keep waiting
            print(f"  check failed ({type(e).__name__}: {e}); retrying", flush=True)
        if time.time() >= end:
            print(f"still AWAITING_IMAGES {a.request_id} after {a.wait} min")
            sys.exit(2)
        time.sleep(a.every)


def cmd_status(a):
    ids = [a.request_id] if a.request_id else sorted(os.listdir(LEDGER)) if os.path.isdir(LEDGER) else []
    for rid in ids:
        r = load(rid)
        print(f"{r['status']:16} {rid}  sent {r.get('sent', '-')}  thread {r.get('gmail_thread_id')}")


ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
sub = ap.add_subparsers(dest="cmd", required=True)
s = sub.add_parser("send")
s.add_argument("--character", required=True)
s.add_argument("--level", required=True, help='e.g. "4" or "5-7"')
s.add_argument("--asset", required=True, help="concept sheet, reference, turnaround, inpaint fix, ...")
s.add_argument("--revision", default="1")
s.add_argument("--images", required=True, help="count and description of the requested images")
s.add_argument("--prompt", help="the exact prompt (or use --prompt-file)")
s.add_argument("--prompt-file")
s.add_argument("--deliverables", required=True, help="required images, views, background/transparency")
s.add_argument("--attach", action="append", default=[], help="path=purpose (repeatable)")
s.add_argument("--request-id", help="override the generated id")
s.add_argument("--from", dest="sender", default=os.environ.get("BOOST_GMAIL_FROM", "nachum.a.rubin@gmail.com"),
               help="send from this Gmail address (needs BOOST_GMAIL_FROM_APP_PASSWORD); never the studio account")
s.add_argument("--dry-run", action="store_true", help="write the ledger and print the mail, don't send")
p = sub.add_parser("poll")
p.add_argument("request_id")
p.add_argument("--wait", type=float, default=0, help="keep checking for this many minutes (0 = check once)")
p.add_argument("--every", type=float, default=60, help="seconds between checks")
t = sub.add_parser("status")
t.add_argument("request_id", nargs="?")
a = ap.parse_args()
{"send": cmd_send, "poll": cmd_poll, "status": cmd_status}[a.cmd](a)
