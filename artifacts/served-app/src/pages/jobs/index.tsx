import { useState } from "react";
import { useListJobs, ListJobsStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badges";
import { Link } from "wouter";
import { Search, Plus, FilterX, PackageCheck } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

export default function JobsList({ filterToServerId }: { filterToServerId?: number }) {
  const [statusFilter, setStatusFilter] = useState<ListJobsStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: jobs, isLoading } = useListJobs(
    { 
      status: statusFilter === "all" ? undefined : statusFilter,
      serverId: filterToServerId
    },
    { query: { queryKey: ["jobs", statusFilter, filterToServerId] } }
  );

  const filteredJobs = jobs?.filter(job => 
    job.recipientName.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (job.caseNumber && job.caseNumber.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {filterToServerId ? "My Assignments" : "Active Jobs"}
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage and track process serving jobs.
          </p>
        </div>
        {!filterToServerId && (
          <Link href="/app/jobs/new" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
            <Plus className="mr-2 h-4 w-4" />
            New Job
          </Link>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by recipient or case number..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="served">Served</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              {statusFilter !== "all" && (
                <Button variant="ghost" size="icon" onClick={() => setStatusFilter("all")}>
                  <FilterX className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Case Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredJobs?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No jobs found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredJobs?.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        <Link href={`/app/jobs/${job.id}`} className="hover:text-primary hover:underline">
                          {job.platformRef}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link href={`/app/jobs/${job.id}`} className="hover:underline">
                          {job.recipientName}
                        </Link>
                      </TableCell>
                      <TableCell>{job.caseNumber || "-"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <StatusBadge status={job.status} />
                          {job.documentHandling === "pickup" && job.pickedUpAt && (
                            <span
                              data-testid={`pickup-pill-${job.id}`}
                              title={`Picked up ${format(new Date(job.pickedUpAt), "PPp")}`}
                              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
                            >
                              <PackageCheck className="h-3 w-3" /> Picked up
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{job.recipientCity}, {job.recipientState}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {format(new Date(job.createdAt), "MMM d, yyyy")}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
