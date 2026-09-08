export type BlindTestAudioKind = "theme" | "terror" | "breathing";

export interface BlindTestTrack {
  id: string;
  killerId: string;
  kind: BlindTestAudioKind;
  url: string;
}

export interface BlindTestPick {
  track: BlindTestTrack;
  weights: Record<string, number>;
}

export function findBlindTestAudioFile(files: Iterable<string>, expectedFileName: string): string | null {
  const expected = normalizeAudioFileName(expectedFileName);
  return [...files].find((file) => normalizeAudioFileName(file) === expected) ?? null;
}

export function getBlindTestPlayback(duration: number, seconds: number, kind: BlindTestAudioKind, random = Math.random): { loop: boolean; startTime: number } {
  const loop = duration < seconds;
  return { loop, startTime: kind === "breathing" || loop ? 0 : random() * Math.max(0, duration - seconds) };
}

export function blindTestResultComment(score: number, totalQuestions: number): string {
  const percentage = totalQuestions > 0 ? score / totalQuestions * 100 : 0;
  if (percentage <= 10) return "J’ai rarement vu un résultat aussi médiocre. Même le hasard aurait probablement fait mieux.";
  if (percentage <= 20) return "On va dire que tu étais surtout là pour l’ambiance.";
  if (percentage <= 30) return "Quelques bonnes réponses ont réussi à se glisser dans ce désastre.";
  if (percentage <= 40) return "Tu reconnais vaguement de la musique, c’est déjà un début.";
  if (percentage <= 50) return "Presque la moyenne. Le “presque” fait beaucoup de travail ici.";
  if (percentage <= 60) return "La moyenne est sauvée. Ton honneur aussi, de justesse.";
  if (percentage <= 70) return "Pas mal du tout. Tu peux commencer à juger les autres sans trop rougir.";
  if (percentage <= 80) return "Très solide. Là, on commence à soupçonner que tu écoutes vraiment de la musique.";
  if (percentage <= 90) return "Excellent score. Tes oreilles méritent clairement leur place sur ta tête.";
  if (percentage < 100) return "Presque parfait. Cette erreur va probablement te hanter plus longtemps qu’elle ne devrait.";
  return "Parfait. Soit tu es une encyclopédie musicale, soit tu as triché avec une discrétion admirable.";
}

export function pickWeightedBlindTestTrack(
  tracks: readonly BlindTestTrack[],
  weights: Readonly<Record<string, number>>,
  random = Math.random
): BlindTestPick | null {
  if (tracks.length === 0) return null;
  const total = tracks.reduce((sum, track) => sum + (weights[track.id] ?? 1), 0);
  let cursor = random() * total;
  const track = tracks.find((candidate) => {
    cursor -= weights[candidate.id] ?? 1;
    return cursor < 0;
  }) ?? tracks.at(-1)!;
  return {
    track,
    weights: Object.fromEntries(tracks.map((candidate) => [
      candidate.id,
      candidate.id === track.id ? 1 : Math.min(5, (weights[candidate.id] ?? 1) + 2)
    ]))
  };
}

function normalizeAudioFileName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}
