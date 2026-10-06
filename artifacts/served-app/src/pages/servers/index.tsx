import { useState } from "react";
import { useListServers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TierBadge } from "@/components/ui/badges";
import { Link } from "wouter";
import { Search, Shield, Activity, Phone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function ServersList() {
  const [searchQuery, setSearchQuery] = useState("");
  const { data: servers, isLoading } = useListServers();

  const filteredServers = servers?.filter(server => 
    server.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (server.serviceArea && server.serviceArea.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Process Servers</h1>
          <p className="text-muted-foreground mt-1">
            Manage field agents and their assignments.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search servers by name or service area..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Server Name</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Service Area</TableHead>
                  <TableHead>Jobs Completed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredServers?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No servers found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredServers?.map((server) => (
                    <TableRow key={server.id}>
                      <TableCell className="font-medium">
                        <Link href={`/app/servers/${server.id}`} className="hover:underline hover:text-primary flex items-center gap-2">
                          <Shield className="h-4 w-4 text-muted-foreground" />
                          {server.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <TierBadge tier={server.serverTier} />
                      </TableCell>
                      <TableCell>{server.serviceArea || "-"}</TableCell>
                      <TableCell className="font-mono">{server.jobsCompleted}</TableCell>
                      <TableCell>
                        {server.active ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
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
