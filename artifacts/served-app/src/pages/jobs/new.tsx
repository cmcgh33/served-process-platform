import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateJob, useListClients, useListServers } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const formSchema = z.object({
  documentType: z.string().min(1, "Document type is required"),
  recipientName: z.string().min(1, "Recipient name is required"),
  recipientAddress: z.string().min(1, "Address is required"),
  recipientCity: z.string().min(1, "City is required"),
  recipientState: z.string().min(2, "State is required").max(2),
  recipientZip: z.string().min(5, "Zip is required"),
  caseNumber: z.string().optional(),
  matterName: z.string().optional(),
  courtName: z.string().optional(),
  petitioner: z.string().optional(),
  respondent: z.string().optional(),
  documentsServed: z
    .array(z.object({ title: z.string(), documentType: z.string() }))
    .default([]),
  notes: z.string().optional(),
  clientId: z.coerce.number().optional(),
  serverId: z.coerce.number().optional(),
});

const DOC_TYPE_OPTIONS = [
  "Summons",
  "Complaint",
  "Petition",
  "Motion",
  "Subpoena",
  "Order",
  "Notice",
  "Other",
] as const;

export default function NewJob() {
  const [, setLocation] = useLocation();
  const createJob = useCreateJob();
  const { data: clients } = useListClients();
  const { data: servers } = useListServers();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      documentType: "",
      recipientName: "",
      recipientAddress: "",
      recipientCity: "",
      recipientState: "",
      recipientZip: "",
      caseNumber: "",
      matterName: "",
      courtName: "",
      petitioner: "",
      respondent: "",
      documentsServed: [],
      notes: "",
    },
  });
  const docsArray = useFieldArray({ control: form.control, name: "documentsServed" });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    const documentsServed = (values.documentsServed ?? [])
      .filter((d) => d.title.trim().length > 0)
      .map((d) => ({
        title: d.title.trim(),
        documentType: d.documentType.trim() || "Other",
      }));
    createJob.mutate(
      {
        data: {
          ...values,
          documentsServed,
          courtName: values.courtName?.trim() || undefined,
          petitioner: values.petitioner?.trim() || undefined,
          respondent: values.respondent?.trim() || undefined,
        },
      },
      {
        onSuccess: (data) => {
          toast.success("Job created successfully", {
            description: `Reference: ${data.platformRef}`,
          });
          setLocation(`/app/jobs/${data.id}`);
        },
        onError: (err) => {
          toast.error("Failed to create job", {
            description: err instanceof Error ? err.message : "Unknown error occurred",
          });
        },
      }
    );
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/app/jobs">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dispatch New Job</h1>
          <p className="text-muted-foreground mt-1">Create a new process serving order.</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Job Details</CardTitle>
              <CardDescription>Legal document and case information.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <FormField
                control={form.control}
                name="documentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Document Type</FormLabel>
                    <FormControl>
                      <Input placeholder="Summons, Subpoena, etc." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="caseNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Case Number</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. CV-2023-1234" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="matterName"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Matter Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Smith v. Jones" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="courtName"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Court Name (Affidavit Caption)</FormLabel>
                    <FormControl>
                      <Input placeholder="Eighth Judicial District Court, Clark County, Nevada" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="petitioner"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Petitioner / Plaintiff</FormLabel>
                    <FormControl>
                      <Input placeholder="Jane Smith" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="respondent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Respondent / Defendant</FormLabel>
                    <FormControl>
                      <Input placeholder="John Jones" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="col-span-2 space-y-2">
                <div className="flex items-center justify-between">
                  <FormLabel>Documents Served</FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => docsArray.append({ title: "", documentType: "Summons" })}
                  >
                    + Add document
                  </Button>
                </div>
                {docsArray.fields.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    None added — affidavit will list the document type above.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {docsArray.fields.map((field, idx) => (
                      <div key={field.id} className="grid grid-cols-[1fr,160px,32px] gap-2 items-start">
                        <FormField
                          control={form.control}
                          name={`documentsServed.${idx}.title` as const}
                          render={({ field: f }) => (
                            <FormItem>
                              <FormControl>
                                <Input placeholder="Document title" {...f} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`documentsServed.${idx}.documentType` as const}
                          render={({ field: f }) => (
                            <FormItem>
                              <Select onValueChange={f.onChange} value={f.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {DOC_TYPE_OPTIONS.map((opt) => (
                                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => docsArray.remove(idx)}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recipient & Location</CardTitle>
              <CardDescription>Who and where to serve the documents.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <FormField
                control={form.control}
                name="recipientName"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Recipient Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="recipientAddress"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Main St" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="recipientCity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input placeholder="City" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="recipientState"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <Input placeholder="CA" maxLength={2} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="recipientZip"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Zip Code</FormLabel>
                      <FormControl>
                        <Input placeholder="90210" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assignments & Notes</CardTitle>
              <CardDescription>Assign to client and server.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client Firm</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value?.toString()}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select Client" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {clients?.map((c) => (
                          <SelectItem key={c.id} value={c.id.toString()}>
                            {c.firmName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="serverId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Process Server (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value?.toString()}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {servers?.filter(s => s.active).map((s) => (
                          <SelectItem key={s.id} value={s.id.toString()}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Instructions / Notes</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Gate code is 1234. Beware of dog." 
                        className="min-h-[100px]"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Button variant="outline" asChild>
              <Link href="/app/jobs">Cancel</Link>
            </Button>
            <Button type="submit" disabled={createJob.isPending}>
              {createJob.isPending ? "Dispatching..." : "Dispatch Job"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
