import { ClassroomView } from "@/components/ClassroomView";
import { Button } from "@/components/ui/button";
import { appPath } from "@/lib/app-path";
export default function ClassroomPage() {
  return <main className="h-svh overflow-y-auto"><div className="px-4 pt-3"><Button asChild variant="ghost"><a href={appPath("/")}>返回学习</a></Button></div><ClassroomView /></main>;
}
