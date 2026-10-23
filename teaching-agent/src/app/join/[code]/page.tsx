import { StudentClassroom } from "@/components/StudentClassroom";
export default async function JoinCodePage({ params }: { params: Promise<{ code: string }> }) {
  return <StudentClassroom code={(await params).code} />;
}
