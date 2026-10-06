import { MapPin, Download, Printer, Mail, CheckCircle2, ArrowLeft, Zap, User, CircleCheck, AlertTriangle } from "lucide-react";

const LEGAL_ENTITY = {
  tradeName: "SERVED.",
};

const SAMPLE_JOB = {
  recipientName: "Samuel Johnson",
  documentType: "Divorce Papers",
  recipientAddress: "4821 Flamingo Rd",
  recipientCity: "Las Vegas",
  recipientState: "NV",
  recipientZip: "89103",
  platformRef: "SERVED-00005-2026",
  caseNumber: "FC-2026-04821",
  createdAt: "2026-04-21T14:32:00Z",
};

const GPS_LAT = 36.1085;
const GPS_LNG = -115.1854;
const GPS_FULL = "36.108500, -115.185400";

function AffidavitDocument({ job }: { job: typeof SAMPLE_JOB }) {
  const servedDate = "April 21, 2026";
  const servedTime = "7:32 AM PDT";
  const address = [job.recipientAddress, job.recipientCity, job.recipientState, job.recipientZip].filter(Boolean).join(", ");

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden font-mono text-sm">
      <div className="px-8 py-4 flex justify-between items-start" style={{ backgroundColor: "#0f1e3c" }}>
        <div>
          <div className="text-amber-400 font-black text-lg tracking-wider">{LEGAL_ENTITY.tradeName}</div>
          <div className="text-white/50 text-xs mt-0.5">On-Demand Process Serving Platform</div>
        </div>
        <div className="text-right text-white/60 text-xs">
          <div>Ref: {job.platformRef}</div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-5">
        <div className="text-center pb-4 border-b border-gray-200">
          <h2 className="text-xl font-bold tracking-widest uppercase">Affidavit of Service</h2>
          <p className="text-gray-500 text-xs mt-1">Proof of Personal Service — {job.documentType}</p>
        </div>

        <div className="space-y-1">
          <p className="font-bold text-sm">STATE OF NEVADA</p>
          <p className="font-bold text-sm">COUNTY OF CLARK</p>
        </div>

        <p className="text-sm leading-relaxed text-gray-700">
          I, <strong>DeShawn Williams</strong>, being duly sworn, declare and say under penalty of perjury under the laws of the State of Nevada:
        </p>
        <p className="text-sm leading-relaxed text-gray-700">
          On <strong>{servedDate} at {servedTime}</strong>, I personally served the documents described below upon:
        </p>

        <div className="border border-gray-200 rounded-lg p-4 space-y-2 bg-gray-50">
          <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Party Served</p>
          <p className="text-sm"><strong>Name:</strong> {job.recipientName}</p>
          <p className="text-sm"><strong>Address:</strong> {address}</p>
          <p className="text-sm"><strong>Manner:</strong> Personal service — documents delivered directly to recipient</p>
          <p className="text-sm"><strong>Notes:</strong> Served directly to recipient at front door. Recipient acknowledged receipt.</p>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Documents Served</p>
          <ul className="list-disc list-inside text-sm text-gray-700 space-y-1 pl-2">
            <li>{job.documentType}</li>
            <li>Summons</li>
          </ul>
        </div>

        <div className="border border-emerald-200 rounded-lg p-4 bg-emerald-50 space-y-1">
          <p className="text-[10px] font-bold tracking-widest text-emerald-700 uppercase">GPS Verification</p>
          <p className="text-xs text-emerald-700">Coordinates: {GPS_FULL}</p>
          <p className="text-xs text-emerald-700">Timestamp: 2026-04-21T14:32:00Z</p>
          <p className="text-xs text-emerald-700">Platform Ref: {job.platformRef}</p>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Process Server</p>
          <p className="text-sm"><strong>Name:</strong> DeShawn Williams</p>
          <p className="text-sm"><strong>Credential:</strong> SERVED. Verified Process Server</p>
          <p className="text-sm"><strong>Platform ID:</strong> SVR-00041</p>
        </div>

        <div className="border-t border-gray-200 pt-4 space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1">Server Signature</p>
              <div className="border-b border-gray-400 pb-1">
                <span className="font-['Brush_Script_MT',cursive] text-2xl text-gray-800">DeShawn Williams</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1">Date</p>
              <p className="text-sm text-gray-700">{servedDate}</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export function ProofOfService() {
  const job = SAMPLE_JOB;
  const address = [job.recipientAddress, job.recipientCity, job.recipientState, job.recipientZip].filter(Boolean).join(", ");
  const servedAt = "4/21/2026, 7:32:00 AM";

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-8">
      <div className="space-y-5 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white">
            <ArrowLeft className="w-4 h-4 text-gray-600" />
          </div>
          <h1 className="text-base font-bold text-gray-900">Proof of Service</h1>
        </div>

        <div className="bg-white rounded-2xl border border-emerald-200 p-8 flex flex-col items-center text-center">
          <div className="relative mb-4">
            <div className="w-20 h-20 rounded-full border-4 border-emerald-200 flex items-center justify-center">
              <div className="w-14 h-14 rounded-full border-4 border-emerald-300 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-emerald-50 border-2 border-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                </div>
              </div>
            </div>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className="absolute w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ top: "50%", left: "50%", transform: `rotate(${i * 60}deg) translateY(-42px) translateX(-3px)` }} />
            ))}
          </div>
          <p className="text-sm font-black tracking-widest text-emerald-600 uppercase">Service Verified</p>
          <p className="text-xs text-gray-400 mt-1">SERVED. Platform — Proof of Service</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-base font-bold text-gray-900">{job.documentType}</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1">Document Type</p>
              <p className="font-medium text-gray-800">{job.documentType}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1">Recipient</p>
              <p className="font-medium text-gray-800">{job.recipientName}</p>
            </div>
            <div className="col-span-2">
              <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1">Address</p>
              <p className="font-medium text-gray-800">{address}</p>
            </div>
            <div className="col-span-2">
              <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1">Served On</p>
              <p className="font-medium text-gray-800">{servedAt}</p>
            </div>
          </div>
        </div>

        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-center justify-between">
          <div className="flex items-start gap-3">
            <MapPin className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[10px] font-bold tracking-widest text-emerald-700 uppercase mb-1">GPS Verified Location</p>
              <p className="text-sm font-mono font-medium text-emerald-700">{GPS_FULL}</p>
              <p className="text-xs text-emerald-600 mt-0.5">4/21/2026, 7:32:00 AM</p>
            </div>
          </div>
          <CircleCheck className="w-6 h-6 text-emerald-500 flex-shrink-0" />
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0">
            <User className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm">DeShawn Williams</p>
            <p className="flex items-center gap-1 text-xs text-amber-600 mt-0.5">
              <Zap className="w-3 h-3" />Verified SERVED. Process Server
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Photo Documentation</p>
          </div>
          <div className="relative">
            <div className="w-full h-48 bg-gradient-to-br from-slate-800 to-slate-900 flex items-end justify-center pb-6 relative overflow-hidden">
              <div className="absolute top-3 left-3 bg-black/70 text-white text-[10px] font-mono px-2 py-1 rounded">
                <div>GPS: {GPS_LAT}, {GPS_LNG}</div>
                <div>2026-04-21 7:32:00 AM PDT</div>
              </div>
              <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-white" />
              </div>
              <div className="flex items-end gap-1">
                <div className="w-16 h-20 bg-slate-700 rounded-sm relative">
                  <div className="absolute top-0 left-0 right-0 h-0 w-0 border-l-[32px] border-r-[32px] border-b-[16px] border-transparent border-b-slate-600 -translate-y-4" />
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-8 bg-amber-400/80 rounded-sm" />
                </div>
                <div className="w-8 h-12 bg-slate-600 rounded-sm" />
              </div>
              <div className="absolute bottom-2 left-3 flex items-center gap-1 px-2 py-1 bg-emerald-500/90 text-white text-[10px] font-bold rounded">
                <CircleCheck className="w-3 h-3" />GPS Verified Photo
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
              <Download className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Proof of Service Affidavit</p>
              <p className="text-xs text-gray-500">Pre-filled, signed, and ready to file</p>
            </div>
          </div>
          <div className="flex gap-2 mb-4">
            <button className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-400 hover:bg-amber-500 text-black font-bold text-sm rounded-lg transition-colors">
              <Download className="w-4 h-4" />Download
            </button>
            <button className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 bg-white text-gray-700 font-semibold text-sm rounded-lg hover:bg-gray-50 transition-colors">
              <Printer className="w-4 h-4" />Print
            </button>
            <button className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 bg-white text-gray-700 font-semibold text-sm rounded-lg hover:bg-gray-50 transition-colors">
              <Mail className="w-4 h-4" />Email
            </button>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-700 leading-relaxed">
            <strong>Need to print?</strong> UPS Store or FedEx Office — email the file to any location for same-day pickup. Or use a Bluetooth mobile printer (Brother PocketJet · Canon PIXMA TR150) in the field.
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Service History</h2>
          <ol className="space-y-3">
            <li className="border border-emerald-200 rounded-xl p-4 bg-white">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-emerald-100 text-emerald-600">
                  <CircleCheck className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200">Served</span>
                    <span className="text-xs text-gray-500">Attempt #3</span>
                    <span className="text-xs text-gray-500">·</span>
                    <span className="text-xs text-gray-700 font-medium">Apr 21, 2026 at 7:32 AM</span>
                  </div>
                  <p className="text-sm text-gray-700">Served personally at front door. Recipient confirmed identity.</p>
                  <div className="text-xs text-sky-700 font-mono">GPS: {GPS_LAT}, {GPS_LNG}</div>
                </div>
              </div>
            </li>
            <li className="border border-gray-200 rounded-xl p-4 bg-white">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-amber-100 text-amber-600">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200">No answer</span>
                    <span className="text-xs text-gray-500">Attempt #2</span>
                    <span className="text-xs text-gray-500">·</span>
                    <span className="text-xs text-gray-700 font-medium">Apr 20, 2026 at 6:14 PM</span>
                  </div>
                  <p className="text-sm text-gray-700">Knocked 3x, doorbell. No response. Lights on inside.</p>
                  <div className="text-xs text-sky-700 font-mono">GPS: 36.10851, -115.18545</div>
                </div>
              </div>
            </li>
            <li className="border border-gray-200 rounded-xl p-4 bg-white">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-amber-100 text-amber-600">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200">No answer</span>
                    <span className="text-xs text-gray-500">Attempt #1</span>
                    <span className="text-xs text-gray-500">·</span>
                    <span className="text-xs text-gray-700 font-medium">Apr 19, 2026 at 9:42 AM</span>
                  </div>
                  <p className="text-sm text-gray-700">No answer; no vehicles in driveway.</p>
                  <div className="text-xs text-sky-700 font-mono">GPS: 36.10848, -115.18538</div>
                </div>
              </div>
            </li>
          </ol>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-900">Payment Summary</h2>
            <Download className="w-4 h-4 text-gray-400" />
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Service fee</span>
              <span className="font-medium text-gray-900">$75</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Platform fee (20%)</span>
              <span className="font-medium text-gray-900">$15</span>
            </div>
            <div className="flex justify-between text-sm border-t border-gray-100 pt-3">
              <span className="font-bold text-gray-900">Server earned (80%)</span>
              <span className="font-black text-emerald-600 text-base">$60</span>
            </div>
          </div>
          <div className="mt-4 p-3 bg-emerald-50 rounded-lg flex items-center justify-between">
            <span className="text-xs font-medium text-emerald-700">Payment Status</span>
            <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">Paid · Instant</span>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Full Affidavit Document</h2>
          <AffidavitDocument job={job} />
        </div>
      </div>
    </div>
  );
}
