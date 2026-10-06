import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Loader2, Building2, ScaleIcon, ArrowRight } from "lucide-react";
import {
  useGetMyFirmProfile,
  useUpdateMyFirmProfile,
  getGetMyFirmProfileQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

interface OnboardingForm {
  firmName: string;
  firmAddress: string;
  firmAddress2: string;
  firmCity: string;
  firmState: string;
  firmZip: string;
  firmPhone: string;
  firmContactName: string;
  barNumber: string;
  barState: string;
}

export default function AttorneyOnboarding() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const profileQuery = useGetMyFirmProfile({
    query: {
      queryKey: getGetMyFirmProfileQueryKey(),
      refetchOnWindowFocus: false,
    },
  });
  const updateProfile = useUpdateMyFirmProfile();

  const form = useForm<OnboardingForm>({
    defaultValues: {
      firmName: "",
      firmAddress: "",
      firmAddress2: "",
      firmCity: "",
      firmState: "NV",
      firmZip: "",
      firmPhone: "",
      firmContactName: "",
      barNumber: "",
      barState: "NV",
    },
  });

  // Hydrate from any partial save (e.g. attorney started, closed tab,
  // came back). Once stamped onboarded, redirect to dashboard so this
  // page never blocks a returning user.
  useEffect(() => {
    const p = profileQuery.data;
    if (!p) return;
    if (p.attorneyOnboardedAt) {
      setLocation("/app/attorney/dashboard");
      return;
    }
    form.reset({
      firmName: p.firmName ?? "",
      firmAddress: p.firmAddress ?? "",
      firmAddress2: p.firmAddress2 ?? "",
      firmCity: p.firmCity ?? "",
      firmState: p.firmState ?? "NV",
      firmZip: p.firmZip ?? "",
      firmPhone: p.firmPhone ?? "",
      firmContactName: p.firmContactName ?? "",
      barNumber: p.barNumber ?? "",
      barState: p.barState ?? "NV",
    });
  }, [profileQuery.data, form, setLocation]);

  const onSubmit = form.handleSubmit(async (values) => {
    // Client-side required-fields gate — mirrors the server's
    // isFirmProfileComplete() check. Bar fields stay optional.
    const required: Array<{ key: keyof OnboardingForm; label: string }> = [
      { key: "firmName", label: "Firm name" },
      { key: "firmAddress", label: "Street address" },
      { key: "firmCity", label: "City" },
      { key: "firmState", label: "State" },
      { key: "firmZip", label: "Zip" },
      { key: "firmPhone", label: "Firm phone" },
      { key: "firmContactName", label: "Contact name" },
    ];
    const missing = required.filter((r) => !values[r.key]?.trim());
    if (missing.length) {
      toast.error(`Please complete: ${missing.map((m) => m.label).join(", ")}`);
      return;
    }
    try {
      const saved = await updateProfile.mutateAsync({ data: values });
      await queryClient.invalidateQueries({
        queryKey: getGetMyFirmProfileQueryKey(),
      });
      if (saved.attorneyOnboardedAt) {
        toast.success("Welcome aboard! Your firm profile is saved.");
        setLocation("/app/attorney/dashboard");
      } else {
        // Server didn't stamp — usually means a required field was
        // somehow still empty. Surface a generic error.
        toast.error("Couldn't complete onboarding. Please double-check the form.");
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't save your firm profile");
    }
  });

  if (profileQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-sky-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-sky-100 mb-4">
            <Building2 className="w-7 h-7 text-sky-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">
            Welcome to SERVED.
          </h1>
          <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
            Tell us about your firm so we can autofill pickup details, populate
            affidavits with your bar info, and route your cases properly.
            Takes about a minute.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 space-y-6"
          data-testid="form-attorney-onboarding"
        >
          {/* Firm identity */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
              <Building2 className="w-4 h-4 text-sky-600" />
              <h2 className="text-sm font-semibold text-gray-900">Firm Identity</h2>
            </div>

            <div>
              <Label htmlFor="ob-firm-name" className="text-xs text-gray-600">
                Firm / office name <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="ob-firm-name"
                data-testid="input-onboarding-firm-name"
                placeholder="Doyle Legal Group, PLLC"
                {...form.register("firmName")}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ob-contact" className="text-xs text-gray-600">
                  Primary contact name <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="ob-contact"
                  data-testid="input-onboarding-contact-name"
                  placeholder="Jennifer Doyle, Esq."
                  {...form.register("firmContactName")}
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Person the server should ask for at pickup.
                </p>
              </div>
              <div>
                <Label htmlFor="ob-phone" className="text-xs text-gray-600">
                  Firm phone <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="ob-phone"
                  data-testid="input-onboarding-firm-phone"
                  placeholder="(702) 555-0100"
                  {...form.register("firmPhone")}
                />
              </div>
            </div>
          </section>

          {/* Office address */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
              <Building2 className="w-4 h-4 text-amber-600" />
              <h2 className="text-sm font-semibold text-gray-900">Office Address</h2>
            </div>

            <div>
              <Label htmlFor="ob-address" className="text-xs text-gray-600">
                Street address <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="ob-address"
                data-testid="input-onboarding-firm-address"
                placeholder="500 Lawyer Lane"
                {...form.register("firmAddress")}
              />
            </div>
            <div>
              <Label htmlFor="ob-address2" className="text-xs text-gray-600">
                Suite / Floor (optional)
              </Label>
              <Input
                id="ob-address2"
                data-testid="input-onboarding-firm-address2"
                placeholder="Suite 200"
                {...form.register("firmAddress2")}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="ob-city" className="text-xs text-gray-600">
                  City <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="ob-city"
                  data-testid="input-onboarding-firm-city"
                  placeholder="Las Vegas"
                  {...form.register("firmCity")}
                />
              </div>
              <div>
                <Label className="text-xs text-gray-600">
                  State <span className="text-rose-500">*</span>
                </Label>
                <Select
                  value={form.watch("firmState") || ""}
                  onValueChange={(v) => form.setValue("firmState", v, { shouldDirty: true })}
                >
                  <SelectTrigger data-testid="input-onboarding-firm-state">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {US_STATES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ob-zip" className="text-xs text-gray-600">
                  Zip <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="ob-zip"
                  data-testid="input-onboarding-firm-zip"
                  placeholder="89101"
                  maxLength={10}
                  {...form.register("firmZip")}
                />
              </div>
            </div>
          </section>

          {/* Bar info — optional */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
              <ScaleIcon className="w-4 h-4 text-emerald-600" />
              <h2 className="text-sm font-semibold text-gray-900">
                State Bar
                <span className="ml-2 text-[11px] font-normal text-gray-400">
                  (optional — encouraged)
                </span>
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Label htmlFor="ob-bar-number" className="text-xs text-gray-600">
                  Bar number
                </Label>
                <Input
                  id="ob-bar-number"
                  data-testid="input-onboarding-bar-number"
                  placeholder="NV-12345"
                  {...form.register("barNumber")}
                />
              </div>
              <div>
                <Label className="text-xs text-gray-600">Bar state</Label>
                <Select
                  value={form.watch("barState") || ""}
                  onValueChange={(v) => form.setValue("barState", v, { shouldDirty: true })}
                >
                  <SelectTrigger data-testid="input-onboarding-bar-state">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {US_STATES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <div className="pt-2">
            <Button
              type="submit"
              data-testid="button-onboarding-submit"
              disabled={updateProfile.isPending}
              className="w-full h-11 bg-sky-600 hover:bg-sky-700 text-white"
            >
              {updateProfile.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Save and continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <p className="text-[11px] text-gray-400 text-center mt-3">
              You can edit any of this later under Settings.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
