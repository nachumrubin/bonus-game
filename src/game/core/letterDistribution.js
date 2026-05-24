// Hebrew letter point values (HV) and bag distribution (HD).
// Ported verbatim from index.html.
// '?' is the joker (blank) tile.

export const HV = {
  'א':1,'ב':3,'ג':5,'ד':3,'ה':4,'ו':1,'ז':8,'ח':4,'ט':8,'י':1,
  'כ':5,'ל':2,'מ':2,'נ':2,'ס':5,'ע':4,'פ':5,'צ':9,'ק':5,'ר':2,'ש':3,'ת':4,'?':0
};

export const HD = {
  'א':11,'ב':3,'ג':2,'ד':3,'ה':6,'ו':10,'ז':1,'ח':3,'ט':1,'י':10,
  'כ':3,'ל':6,'מ':5,'נ':6,'ס':2,'ע':3,'פ':3,'צ':2,'ק':3,'ר':6,'ש':4,'ת':4,'?':2
};

export const ALL_LETTERS = Object.keys(HV).filter(l => l !== '?');
