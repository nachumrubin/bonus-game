#!/usr/bin/env node
// Byte-level patcher for wolig.pl — adds a -p (pairs) mode that emits
// "surface\tlemma\tpos_details" triples instead of bare surface forms.
//
// We patch the file as raw bytes (Buffer) rather than text because wolig.pl
// is ISO-8859-8 encoded and a UTF-8 round-trip corrupts every Hebrew literal
// in the source. All our anchor strings and inserts are pure ASCII so byte
// concatenation is safe.
//
// Idempotent: re-running detects an already-applied patch and exits clean.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(HERE, 'sources', 'hspell-1.4', 'wolig.pl');

function replaceAnchored(buf, before, after, label) {
  const text = buf.toString('binary'); // 1:1 byte-to-char mapping
  const matches = [];
  let pos = 0;
  while ((pos = text.indexOf(before, pos)) >= 0) { matches.push(pos); pos += before.length; }
  if (matches.length === 0) throw new Error(`anchor '${label}' not found`);
  if (matches.length > 1) throw new Error(`anchor '${label}' matched ${matches.length} times`);
  const idx = matches[0];
  return Buffer.concat([
    buf.subarray(0, idx),
    Buffer.from(after, 'binary'),
    buf.subarray(idx + before.length),
  ]);
}

function alreadyPatched(buf) {
  return buf.toString('binary').includes('$pairs_output=0;');
}

function main() {
  let buf = fs.readFileSync(TARGET);
  if (alreadyPatched(buf)) { console.log('wolig.pl already patched.'); return; }

  // 1) Add globals after `my $detail_prefix;`
  buf = replaceAnchored(
    buf,
    'my $detail_prefix;\n',
    'my $detail_prefix;\nmy $pairs_output=0;\nmy $current_lemma;\n',
    'globals'
  );

  // 2) Add early return in outword right after the "*" filter line.
  //    Inserted just *after* the existing `return if $word =~ m/^\*/;`.
  buf = replaceAnchored(
    buf,
    'return if $word =~ m/^\\*/;\n',
    'return if $word =~ m/^\\*/;\n  return if $pairs_output && !defined($details);\n',
    'early-return'
  );

  // 3) Replace the detailed_output block so it emits tab-separated triples
  //    in pairs mode.
  buf = replaceAnchored(
    buf,
    'if($detailed_output && defined($details)){\n    $word =~ s/-$//;  # smichut is already known by the details...\n    $word .= " ".$detail_prefix.$details;\n  }\n',
    'if($detailed_output && defined($details)){\n    $word =~ s/-$//;  # smichut is already known by the details...\n    if($pairs_output){\n      $word .= "\\t".$current_lemma."\\t".$detail_prefix.$details;\n    } else {\n      $word .= " ".$detail_prefix.$details;\n    }\n  }\n',
    'detailed-block'
  );

  // 4) Add -p flag parsing. Replace the existing single-flag block with a
  //    while-loop that handles both -d and -p in any order.
  buf = replaceAnchored(
    buf,
    '  if($ARGV[0] eq "-d"){\n    $detailed_output=!$detailed_output;\n    shift @ARGV;\n  }\n  $infile=$ARGV[0];\n',
    '  while($#ARGV >= 0 && $ARGV[0] =~ /^-/){\n    if($ARGV[0] eq "-d"){\n      $detailed_output=!$detailed_output;\n    } elsif($ARGV[0] eq "-p"){\n      $pairs_output=1;\n      $detailed_output=1;\n    } else {\n      last;\n    }\n    shift @ARGV;\n  }\n  $infile=$ARGV[0];\n',
    'flag-parsing'
  );

  // 5) Snapshot the lemma before any string transforms (inword/outword
  //    mutate $word). Insert right after the optstring-not-defined die.
  buf = replaceAnchored(
    buf,
    'die "Type of word \'".$word."\' was not specified." if !defined($optstring);\n',
    'die "Type of word \'".$word."\' was not specified." if !defined($optstring);\n  $current_lemma=$word;\n  $current_lemma =~ s/^\\*//;\n',
    'lemma-snapshot'
  );

  fs.writeFileSync(TARGET, buf);
  console.log('Patched wolig.pl (', buf.byteLength, 'bytes).');
}

main();
