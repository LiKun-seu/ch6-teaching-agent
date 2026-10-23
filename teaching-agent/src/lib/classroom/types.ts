// Browser-safe DTOs. Never import the question bank into the student entry point.
export type PublicQuestion = {
  id: string;
  type: "choice" | "judge" | "fill";
  prompt: string;
  options: { id: string; text: string }[];
  difficulty?: string;
};
export type OwnSubmission = { answer: string; revision: number; submittedAt: number; grade?: boolean | null };
export type RoundView = {
  id: string; sequence: number; status: "open" | "closed" | "revealed";
  question: PublicQuestion; openedAt: number;
  answer?: string | null; analysis?: string | null;
  submission?: OwnSubmission | null;
};
export type ClassroomSummary = {
  id: string; code: string; title: string; status: "waiting" | "active" | "ended";
  version: number; createdAt: number;
};
export type StudentSnapshot = {
  classroom: ClassroomSummary;
  participant: { id: string; name: string };
  rounds: RoundView[];
};
export type TeacherRound = RoundView & {
  stats: { submitted: number; unanswered: number; correct: number; incorrect: number; pending: number; distribution: Record<string, number> };
  submissions: (OwnSubmission & { participantId: string; name: string; studentNo: string })[];
};
export type TeacherSnapshot = {
  classroom: ClassroomSummary;
  participants: { id: string; name: string; studentNo: string; joinedAt: number }[];
  rounds: TeacherRound[];
};
export type Snapshot = StudentSnapshot | TeacherSnapshot;
