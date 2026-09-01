/** 24 words, one per second — 3 rows of TRANSCRIPT_WORDS_PER_ROW (RESP-024 row tests). */
export const words = Array.from({ length: 24 }, (_, i) => ({ word: `w${i}`, start: i, end: i + 1 }));
