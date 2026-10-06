import JobsList from "./jobs/index";

export default function MyJobs() {
  // In a real app, this would be the logged-in user's ID.
  // For this demo, we'll hardcode to server ID 1 (or allow selection).
  // Assuming ID 1 exists as per standard seeding.
  return <JobsList filterToServerId={1} />;
}
