import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useUser } from "@clerk/react";
import { toast } from "sonner";
import { Loader2, Building2, User as UserIcon } from "lucide-react";
import {
  useGetMyFirmProfile,
  useGetMyAccount,
  useUpdateMyFirmProfile,
  useUpdateMyAccount,
  getGetMyFirmProfileQueryKey,
  getGetMyAccountQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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

interface FirmProfileForm {
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

interface AccountForm {
  phone: string;
  smsOptOut: boolean;
}

export default function AttorneySettings() {
  const queryClient = useQueryClient();
  const { user: clerkUser } = useUser();

  const meQuery = useGetMyAccount({
    query: {
      queryKey: getGetMyAccountQueryKey(),
      refetchOnWindowFocus: false,
    },
  });
  const profileQuery = useGetMyFirmProfile({
    query: {
      queryKey: getGetMyFirmProfileQueryKey(),
      refetchOnWindowFocus: false,
    },
  });
  const updateProfile = useUpdateMyFirmProfile();
  const updateAccount = useUpdateMyAccount();

  const profileForm = useForm<FirmProfileForm>({
    defaultValues: {
      firmName: "",
      firmAddress: "",
      firmAddress2: "",
      firmCity: "",
      firmState: "",
      firmZip: "",
      firmPhone: "",
      firmContactName: "",
      barNumber: "",
      barState: "",
    },
  });

  const accountForm = useForm<AccountForm>({
    defaultValues: { phone: "", smsOptOut: false },
  });

  // Hydrate the firm-profile form once the API responds. Reset rather
  // than setValue so dirty tracking starts fresh from the saved values.
  useEffect(() => {
    const p = profileQuery.data;
    if (!p) return;
    profileForm.reset({
      firmName: p.firmName ?? "",
      firmAddress: p.firmAddress ?? "",
      firmAddress2: p.firmAddress2 ?? "",
      firmCity: p.firmCity ?? "",
      firmState: p.firmState ?? "",
      firmZip: p.firmZip ?? "",
      firmPhone: p.firmPhone ?? "",
      firmContactName: p.firmContactName ?? "",
      barNumber: p.barNumber ?? "",
      barState: p.barState ?? "",
    });
  }, [profileQuery.data, profileForm]);

  // Hydrate the account-prefs form. Phone + SMS opt-out live on the
  // users row and come back from /me; display name + email are owned by
  // Clerk and rendered read-only below.
  useEffect(() => {
    const m = meQuery.data;
    if (!m) return;
    accountForm.reset({
      phone: m.phone ?? "",
      smsOptOut: m.smsOptOut ?? false,
    });
  }, [meQuery.data, accountForm]);

  const onSaveProfile = profileForm.handleSubmit(async (values) => {
    try {
      await updateProfile.mutateAsync({ data: values });
      await queryClient.invalidateQueries({
        queryKey: getGetMyFirmProfileQueryKey(),
      });
      toast.success("Firm profile saved");
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't save firm profile");
    }
  });

  const onSaveAccount = accountForm.handleSubmit(async (values) => {
    try {
      await updateAccount.mutateAsync({
        data: { phone: values.phone, smsOptOut: values.smsOptOut },
      });
      await queryClient.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      toast.success("Account preferences saved");
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't save account preferences");
    }
  });

  const displayName =
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ").trim() ||
    clerkUser?.primaryEmailAddress?.emailAddress ||
    "—";
  const email = clerkUser?.primaryEmailAddress?.emailAddress ?? "—";

  const loadingAny = profileQuery.isLoading || meQuery.isLoading;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your account and firm profile. Your firm address autofills the pickup section on every new job.
        </p>
      </header>

      {loadingAny && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading your settings…
        </div>
      )}

      {/* ------------------------- Account section ------------------------- */}
      <form
        onSubmit={onSaveAccount}
        className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-100 flex items-center justify-center">
            <UserIcon className="w-4 h-4 text-sky-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Account</h2>
            <p className="text-xs text-gray-500">
              Your sign-in details and notification preferences.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs text-gray-600">Display name</Label>
            <Input value={displayName} disabled className="bg-gray-50" />
            <p className="text-[11px] text-gray-400 mt-1">
              Edit in your <a href="/app/account" className="underline hover:text-gray-600">Clerk account</a>.
            </p>
          </div>
          <div>
            <Label className="text-xs text-gray-600">Email</Label>
            <Input value={email} disabled className="bg-gray-50" />
            <p className="text-[11px] text-gray-400 mt-1">
              Managed by Clerk; not editable here.
            </p>
          </div>
          <div>
            <Label htmlFor="acct-phone" className="text-xs text-gray-600">
              Phone (for SMS notifications)
            </Label>
            <Input
              id="acct-phone"
              data-testid="input-account-phone"
              placeholder="+1 (702) 555-0123"
              {...accountForm.register("phone")}
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Used for pickup-ready and other transactional SMS. Leave blank to receive email only.
            </p>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <Checkbox
                data-testid="checkbox-sms-opt-out"
                checked={accountForm.watch("smsOptOut")}
                onCheckedChange={(v) => accountForm.setValue("smsOptOut", v === true)}
              />
              <span>Don't send me SMS notifications</span>
            </label>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            data-testid="button-save-account"
            disabled={updateAccount.isPending}
          >
            {updateAccount.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save account
          </Button>
        </div>
      </form>

      {/* ------------------------ Firm Profile section --------------------- */}
      <form
        onSubmit={onSaveProfile}
        className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center">
            <Building2 className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Firm Profile</h2>
            <p className="text-xs text-gray-500">
              Saved here once, autofilled into the pickup block on every new job.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="firm-name" className="text-xs text-gray-600">Firm / office name</Label>
            <Input
              id="firm-name"
              data-testid="input-firm-name"
              placeholder="Doyle Legal Group, PLLC"
              {...profileForm.register("firmName")}
            />
          </div>
          <div>
            <Label htmlFor="firm-address" className="text-xs text-gray-600">Street address</Label>
            <Input
              id="firm-address"
              data-testid="input-firm-address"
              placeholder="500 Lawyer Lane"
              {...profileForm.register("firmAddress")}
            />
          </div>
          <div>
            <Label htmlFor="firm-address2" className="text-xs text-gray-600">
              Suite / Floor (optional)
            </Label>
            <Input
              id="firm-address2"
              data-testid="input-firm-address2"
              placeholder="Suite 200"
              {...profileForm.register("firmAddress2")}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <Label htmlFor="firm-city" className="text-xs text-gray-600">City</Label>
              <Input
                id="firm-city"
                data-testid="input-firm-city"
                placeholder="Las Vegas"
                {...profileForm.register("firmCity")}
              />
            </div>
            <div>
              <Label className="text-xs text-gray-600">State</Label>
              <Select
                value={profileForm.watch("firmState") || ""}
                onValueChange={(v) => profileForm.setValue("firmState", v, { shouldDirty: true })}
              >
                <SelectTrigger data-testid="input-firm-state">
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
              <Label htmlFor="firm-zip" className="text-xs text-gray-600">Zip</Label>
              <Input
                id="firm-zip"
                data-testid="input-firm-zip"
                placeholder="89101"
                maxLength={10}
                {...profileForm.register("firmZip")}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="firm-contact-name" className="text-xs text-gray-600">
                Default pickup contact
              </Label>
              <Input
                id="firm-contact-name"
                data-testid="input-firm-contact-name"
                placeholder="Front desk paralegal"
                {...profileForm.register("firmContactName")}
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Person the server should ask for at pickup.
              </p>
            </div>
            <div>
              <Label htmlFor="firm-phone" className="text-xs text-gray-600">Firm phone</Label>
              <Input
                id="firm-phone"
                data-testid="input-firm-phone"
                placeholder="(702) 555-0100"
                {...profileForm.register("firmPhone")}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Label htmlFor="firm-bar-number" className="text-xs text-gray-600">
              State bar number (optional)
            </Label>
            <Input
              id="firm-bar-number"
              data-testid="input-firm-bar-number"
              placeholder="NV-12345"
              {...profileForm.register("barNumber")}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-600">Bar state</Label>
            <Select
              value={profileForm.watch("barState") || ""}
              onValueChange={(v) => profileForm.setValue("barState", v, { shouldDirty: true })}
            >
              <SelectTrigger data-testid="input-firm-bar-state">
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

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-gray-400">
            You can override these fields on any individual job.
          </p>
          <Button
            type="submit"
            data-testid="button-save-firm-profile"
            disabled={updateProfile.isPending}
          >
            {updateProfile.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save firm profile
          </Button>
        </div>
      </form>
    </div>
  );
}
