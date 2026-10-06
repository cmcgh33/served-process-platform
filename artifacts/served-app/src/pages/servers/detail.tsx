import { useGetServer, useUpdateServer, getGetServerQueryKey } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TierBadge } from "@/components/ui/badges";
import { ArrowLeft, User, Phone, Mail, Map, ShieldCheck, Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export default function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const serverId = parseInt(id, 10);
  const queryClient = useQueryClient();

  const { data: server, isLoading } = useGetServer(serverId, {
    query: { queryKey: getGetServerQueryKey(serverId), enabled: !!serverId },
  });
  const updateServer = useUpdateServer();

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!server) return <div>Server not found</div>;

  const handleToggleActive = (checked: boolean) => {
    updateServer.mutate(
      { id: serverId, data: { active: checked } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetServerQueryKey(serverId), data);
          toast.success(`Server marked as ${checked ? 'Active' : 'Inactive'}`);
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/app/servers">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{server.name}</h1>
            <TierBadge tier={server.serverTier} />
          </div>
          <p className="text-muted-foreground mt-1">Joined {format(new Date(server.createdAt), "MMMM yyyy")}</p>
        </div>
        <div className="flex items-center gap-2 border rounded-md px-4 py-2 bg-card">
          <Switch 
            id="active-mode" 
            checked={server.active} 
            onCheckedChange={handleToggleActive}
            disabled={updateServer.isPending}
          />
          <Label htmlFor="active-mode">Active for Dispatch</Label>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" /> Contact Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span>{server.email}</span>
            </div>
            {server.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{server.phone}</span>
              </div>
            )}
            {server.serviceArea && (
              <div className="flex items-center gap-3">
                <Map className="h-4 w-4 text-muted-foreground" />
                <span>Service Area: {server.serviceArea}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> Credentials & Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm font-medium text-muted-foreground block">License Number</span>
                <span className="font-mono">{server.licenseNumber || "N/A"}</span>
              </div>
              <div>
                <span className="text-sm font-medium text-muted-foreground block">Total Jobs Completed</span>
                <span className="text-2xl font-bold">{server.jobsCompleted}</span>
              </div>
            </div>
            
            {/* Note: In a real app we would fetch the server's specific jobs here */}
            <div className="border-t pt-4">
              <Button variant="outline" className="w-full" asChild>
                <Link href={`/jobs?serverId=${server.id}`}>View Assigned Jobs</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
