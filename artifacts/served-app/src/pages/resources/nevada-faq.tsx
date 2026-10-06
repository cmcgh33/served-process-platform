import { useEffect } from "react";
import { Link } from "wouter";
import { useSeo } from "@/lib/useSeo";
import { ArrowLeft, ShieldCheck, FileText, Phone } from "lucide-react";

const UPDATED = "May 16, 2026";

interface FaqItem {
  q: string;
  a: string;
  body: React.ReactNode;
}

const FAQS: FaqItem[] = [
  {
    q: "How much does it cost to serve someone in Las Vegas or Nevada?",
    a: "Routine personal service of process in Clark County typically runs $75 to $125 for a standard attempt window (3–5 days). Rush, after-hours, and rural service in Nevada cost more — often $125 to $250 — and skip-trace add-ons (locating an evasive defendant) are usually billed separately. SERVED. publishes fixed-tier pricing inside the app so you see the exact total before posting.",
    body: (
      <>
        <p>
          Routine personal service of process in Clark County typically runs{" "}
          <strong>$75 to $125</strong> for a standard attempt window of three to
          five business days. Rush, same-day, after-hours, and rural Nevada
          service (Nye, Lincoln, Esmeralda, White Pine counties) generally cost{" "}
          <strong>$125 to $250</strong>. Skip-trace add-ons (locating an evasive
          defendant) are usually billed separately at $50–$150.
        </p>
        <p>
          SERVED. publishes fixed-tier pricing inside the platform so the total
          is locked in before you post — no surprise per-attempt fees, no
          mileage charges for in-county service.
        </p>
      </>
    ),
  },
  {
    q: "What is NRS 53.045 and why does it matter for affidavits of service?",
    a: "NRS 53.045 is the Nevada statute that lets a process server sign an unsworn declaration 'under penalty of perjury' that carries the same legal weight as a notarized affidavit. Every SERVED. affidavit prints the NRS 53.045 declaration directly above the server's signature, which is why our affidavits don't require a separate notary jurat.",
    body: (
      <>
        <p>
          <strong>NRS 53.045</strong> is the Nevada statute that allows any
          person to sign an unsworn declaration "under penalty of perjury under
          the law of the State of Nevada" that carries the same legal weight as
          a notarized affidavit. For process servers, this means the affidavit
          of service does not need to be notarized — the NRS 53.045 declaration
          printed above the server's signature is itself the sworn statement.
        </p>
        <p>
          Every SERVED. affidavit prints the full NRS 53.045 declaration
          directly above the server's typed name and signature, which is why
          our affidavits are accepted by Eighth Judicial District, Second
          Judicial District, Justice Courts, and Family Court without a
          separate notary jurat.
        </p>
      </>
    ),
  },
  {
    q: "What does NRS 14.090 require for proof of service in Nevada?",
    a: "NRS 14.090 sets the contents of the proof of service: who served, who was served, when, where, by what method (personal, substitute, or by mail), and the method used to identify the recipient. SERVED. captures all of this automatically — including GPS coordinates, identity-verification method, and a timestamped attempt history — so the affidavit complies on the first filing.",
    body: (
      <>
        <p>
          <strong>NRS 14.090</strong> and the Nevada Rules of Civil Procedure
          (NRCP 4.2 for individuals, NRCP 4.3 for entities) set the required
          contents of the proof of service:
        </p>
        <ul className="list-disc pl-6 space-y-1.5 mt-2">
          <li>The identity of the person who effected service.</li>
          <li>The identity of the person served (with the verification method).</li>
          <li>The date, time, and street address of service.</li>
          <li>
            The manner of service (personal, substitute under NRCP 4.2(a)(2),
            service on a corporate officer, posting, publication, or mail).
          </li>
          <li>The documents served, listed by title.</li>
        </ul>
        <p>
          SERVED. captures every required field automatically and adds GPS
          coordinates and a full attempt history, so the affidavit is
          court-ready the moment service is complete.
        </p>
      </>
    ),
  },
  {
    q: "What happens if the person being served avoids me?",
    a: "Nevada law (NRCP 4.2(a)(2)) allows 'substitute service' after diligent attempts — leaving the documents with a competent person at the defendant's home or usual place of business and mailing a copy. If the defendant cannot be found at all, NRS 14.040 allows service by publication with a court order. If diligent search produces no contact, a server can file a Return of Non-Est instead.",
    body: (
      <>
        <p>
          Nevada gives you three escalation paths when a defendant is evading
          service:
        </p>
        <ol className="list-decimal pl-6 space-y-2 mt-2">
          <li>
            <strong>Substitute service (NRCP 4.2(a)(2)).</strong> After diligent
            attempts at personal service, the server may leave the documents
            with a person of suitable age and discretion at the defendant's
            dwelling or usual place of business and mail a copy to the same
            address. This is the most common evasion workaround.
          </li>
          <li>
            <strong>Service by publication (NRS 14.040).</strong> If the
            defendant cannot be located at all, you can file a motion for
            service by publication. Once a court order is granted, the summons
            is published in a county newspaper for four weeks.
          </li>
          <li>
            <strong>Return of Non-Est.</strong> If diligent search produces no
            contact and the matter requires it, the server files a written
            diligent-search summary and returns the documents un-served. SERVED.
            generates the non-est return automatically.
          </li>
        </ol>
      </>
    ),
  },
  {
    q: "How long does service of process take in Clark County?",
    a: "Routine personal service in Clark County is usually complete within 3–5 business days from posting. Rush service (24–48 hours) is available for an upcharge. Evasive defendants requiring multiple attempts, substitute service, or skip-tracing typically extend the timeline to 7–14 days. Service by publication adds 30+ days because of the four-week newspaper run.",
    body: (
      <>
        <p>
          Typical timelines for Clark County (Las Vegas, Henderson, North Las
          Vegas, Boulder City):
        </p>
        <ul className="list-disc pl-6 space-y-1.5 mt-2">
          <li>
            <strong>Routine service:</strong> 3–5 business days from posting,
            usually 2–4 attempts at different times of day.
          </li>
          <li>
            <strong>Rush service:</strong> Same-day or next-business-day,
            available 7 days a week for an upcharge.
          </li>
          <li>
            <strong>Evasive defendant requiring substitute service:</strong>{" "}
            7–14 days, including the mailed-copy follow-up required by NRCP
            4.2(a)(2).
          </li>
          <li>
            <strong>Service by publication:</strong> 30+ days from court order
            (four weekly publications).
          </li>
        </ul>
      </>
    ),
  },
  {
    q: "Can a process server serve someone at their workplace in Nevada?",
    a: "Yes — Nevada has no statutory prohibition on workplace service and it is routine. The server may not disrupt the workplace, disclose the nature of the documents to coworkers, or trespass into private offices. Personal service at the front desk, lobby, or parking lot is standard practice and is fully NRS-compliant.",
    body: (
      <>
        <p>
          Yes. Nevada has no statutory prohibition on serving an individual at
          their place of employment, and workplace service is one of the most
          common ways to reach defendants who are evasive at home.
        </p>
        <p>
          Professional rules of conduct require the server to:
        </p>
        <ul className="list-disc pl-6 space-y-1.5 mt-2">
          <li>Not disclose the nature of the documents to coworkers or supervisors.</li>
          <li>
            Not enter restricted areas (private offices, secured floors)
            without permission.
          </li>
          <li>
            Conduct service quickly and quietly — usually at the front desk, in
            the lobby, or in the parking lot.
          </li>
        </ul>
        <p>
          Substitute service at a workplace under NRCP 4.2(a)(2) is also
          permitted (left with a person of suitable age at the recipient's
          usual place of business, followed by a mailed copy).
        </p>
      </>
    ),
  },
  {
    q: "What's the difference between personal service and substitute service?",
    a: "Personal service means the documents are physically handed to the named defendant. Substitute service (NRCP 4.2(a)(2)) means the documents are left with a competent adult at the defendant's home or workplace after diligent attempts at personal service, followed by a mailed copy. Both are valid; personal service is preferred when achievable.",
    body: (
      <>
        <p>
          <strong>Personal service</strong> means the documents are physically
          handed to the named defendant. The server confirms identity (verbally,
          by photo match, or by other reliable means), hands the documents over,
          and the defendant is on notice from that moment.
        </p>
        <p>
          <strong>Substitute service</strong> under NRCP 4.2(a)(2) is used when
          personal service has been attempted diligently and failed. The server
          leaves the documents with a person of suitable age and discretion at
          the defendant's dwelling or usual place of business and{" "}
          <em>also</em> mails a copy to the same address. The mailed copy is
          required — without it, substitute service is incomplete.
        </p>
        <p>
          SERVED. generates a companion <strong>Notice of Service by Mail</strong>{" "}
          PDF alongside the affidavit whenever substitute service is logged, so
          both filings are paired and ready for the clerk.
        </p>
      </>
    ),
  },
  {
    q: "Can a process server enter gated communities, apartment complexes, or private property in Nevada?",
    a: "A process server may enter common areas of apartment complexes and approach the front door of a residence to attempt service. Gated communities and locked buildings can refuse entry; in practice, servers either request entry from gate staff, wait for a resident to enter, or attempt service when the defendant leaves. A server may not break and enter, hide in private property, or trespass into restricted areas.",
    body: (
      <>
        <p>
          Nevada process servers operate under the same trespass rules as any
          other visitor. In practice:
        </p>
        <ul className="list-disc pl-6 space-y-1.5 mt-2">
          <li>
            <strong>Single-family homes:</strong> A server may approach the
            front door, knock, and attempt service. Walking around the property,
            climbing fences, or entering through an unlocked side door is
            generally not permitted.
          </li>
          <li>
            <strong>Apartment complexes:</strong> Common areas (hallways,
            lobbies, parking lots) are generally accessible. Buzzer entry,
            attempts at the door, and waiting in common areas are routine.
          </li>
          <li>
            <strong>Gated communities:</strong> The server may request entry
            from gate staff with the case caption. Many HOAs permit access; some
            refuse. If refused, the server typically attempts service when the
            defendant leaves the community.
          </li>
          <li>
            <strong>Workplaces and businesses:</strong> Public-facing areas
            (lobbies, retail floors) are accessible. Restricted areas require
            permission.
          </li>
        </ul>
      </>
    ),
  },
  {
    q: "What is service by publication under NRS 14.040 and when is it used?",
    a: "NRS 14.040 allows service of a summons by publication in a newspaper when the defendant cannot be located after diligent search. It requires a court order, four weekly publications in a county newspaper, and mailing to the defendant's last known address. It is used as a last resort, typically in divorce, quiet-title, and unknown-defendant cases.",
    body: (
      <>
        <p>
          <strong>NRS 14.040</strong> is Nevada's service-by-publication
          statute. It applies when:
        </p>
        <ul className="list-disc pl-6 space-y-1.5 mt-2">
          <li>The defendant cannot be found in Nevada after diligent search; OR</li>
          <li>The defendant is concealing themselves to avoid service; OR</li>
          <li>The defendant is a non-resident with property in Nevada that is the subject of the action.</li>
        </ul>
        <p>
          The plaintiff must file a motion supported by an affidavit showing
          diligent search. If granted, the summons must be published in a
          newspaper in the county where the action is pending{" "}
          <strong>once per week for four consecutive weeks</strong>, and a copy
          must be mailed to the defendant's last known address.
        </p>
        <p>
          It is used as a last resort — most commonly in divorce, quiet-title,
          and unknown-heir matters. SERVED. generates the affidavit of
          publication directly from the captured publication dates, newspaper
          name, and county.
        </p>
      </>
    ),
  },
  {
    q: "Who is licensed to serve process in Nevada?",
    a: "Nevada requires process servers to register with the Private Investigator's Licensing Board (PILB) under NRS 648. There are several categories: licensed Nevada process servers, sheriffs and constables, registered process servers, and (for certain matters) any non-party adult. Every SERVED. server is PILB-registered and the license number is printed on every affidavit.",
    body: (
      <>
        <p>
          Nevada regulates process serving through the{" "}
          <strong>Private Investigator's Licensing Board (PILB)</strong> under
          NRS 648. Authorized servers fall into four categories:
        </p>
        <ul className="list-disc pl-6 space-y-1.5 mt-2">
          <li>
            <strong>Licensed Nevada process servers</strong> — full PILB
            licensees who may serve in any Nevada jurisdiction.
          </li>
          <li>
            <strong>Sheriffs, constables, and marshals</strong> — public
            officers authorized by statute.
          </li>
          <li>
            <strong>Registered process servers</strong> — work-card holders
            operating under a licensed Qualifying Agent.
          </li>
          <li>
            <strong>Private persons</strong> — under NRCP 4(c), any non-party
            adult may serve a summons in Nevada civil matters, though most
            attorneys prefer a licensed professional for evidentiary reasons.
          </li>
        </ul>
        <p>
          Every SERVED. server is PILB-registered or licensed, and the license
          number, server type classification, and registration jurisdiction are
          printed on every affidavit so it is filing-ready in any Nevada court.
        </p>
      </>
    ),
  },
  {
    q: "Do I need to be present when my server effects service?",
    a: "No. The requester does not need to be present and, in most cases, should not be — the defendant should learn of the lawsuit from the documents and the server, not from the opposing party. SERVED. notifies you the moment service is complete, with GPS coordinates and the affidavit attached.",
    body: (
      <>
        <p>
          No — and in most cases, you should not be present. The defendant
          should learn of the action from the documents themselves and the
          neutral process server, not from the opposing party. A requester
          appearing at the scene of service can complicate matters, give rise
          to claims of intimidation, and is generally discouraged.
        </p>
        <p>
          With SERVED. you receive a live notification the moment service is
          complete, including:
        </p>
        <ul className="list-disc pl-6 space-y-1.5 mt-2">
          <li>GPS coordinates of where service occurred.</li>
          <li>The identity-verification method used.</li>
          <li>The completed NRS 53.045-compliant affidavit (PDF).</li>
          <li>
            For substitute service, the companion Notice of Service by Mail
            (NRCP 4.2(a)(2)).
          </li>
        </ul>
      </>
    ),
  },
  {
    q: "What happens if service fails?",
    a: "If a server cannot complete service within the agreed attempt window, SERVED. provides a full attempt log (timestamps, GPS, outcome, photos) so you can decide your next step: extend, escalate to substitute service, request skip-tracing, file for service by publication, or file a Return of Non-Est. There is no penalty for re-posting the same job.",
    body: (
      <>
        <p>
          If the server cannot complete service within the agreed attempt
          window, you receive a full attempt log — timestamps, GPS coordinates,
          outcomes, notes, and any photos. From there you have several options:
        </p>
        <ul className="list-disc pl-6 space-y-1.5 mt-2">
          <li>
            <strong>Extend the attempt window</strong> with the same server.
          </li>
          <li>
            <strong>Escalate to substitute service</strong> under NRCP 4.2(a)(2)
            if diligent personal-service attempts have been documented.
          </li>
          <li>
            <strong>Request skip-tracing</strong> to locate a defendant who has
            moved or is concealing themselves.
          </li>
          <li>
            <strong>File a motion for service by publication</strong> under NRS
            14.040 if the defendant cannot be located.
          </li>
          <li>
            <strong>File a Return of Non-Est</strong> documenting diligent
            search.
          </li>
        </ul>
        <p>
          SERVED. does not charge a re-post fee for jobs where service failed
          through no fault of the requester.
        </p>
      </>
    ),
  },
];

export default function NevadaFaqPage() {
  useSeo({
    title:
      "Nevada Process Serving FAQ — Costs, Timelines, NRS 53.045 & NRS 14.040 | SERVED.",
    description:
      "Plain-English answers to the most common questions about process serving in Nevada: cost in Las Vegas, NRS 53.045 affidavits, NRS 14.040 service by publication, substitute service under NRCP 4.2(a)(2), and what to do when a defendant evades service.",
    path: "/nevada-process-serving-faq",
  });

  // Emit FAQPage structured data so Google can render rich results
  // (collapsible Q&A snippets) directly in search.
  useEffect(() => {
    const id = "faq-structured-data";
    const existing = document.getElementById(id);
    if (existing) existing.remove();

    const script = document.createElement("script");
    script.id = id;
    script.type = "application/ld+json";
    script.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQS.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    });
    document.head.appendChild(script);

    return () => {
      const el = document.getElementById(id);
      if (el) el.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#0f1e3c] text-white">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-white/80 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>
          <span className="text-sm font-bold tracking-widest">SERVED.</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-8">
          <div className="text-[11px] font-bold tracking-widest uppercase text-amber-600 mb-2">
            Resources · Nevada
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#0f1e3c] tracking-tight">
            Nevada Process Serving FAQ
          </h1>
          <p className="mt-3 text-base text-gray-600 leading-relaxed">
            Plain-English answers to the questions Nevada attorneys, paralegals,
            and individuals ask most often about process serving — costs in Las
            Vegas, statutory requirements under NRS 14.090 and NRS 53.045,
            substitute service under NRCP 4.2(a)(2), service by publication
            under NRS 14.040, and what to do when a defendant evades service.
          </p>
          <p className="mt-2 text-xs text-gray-500">Updated {UPDATED}</p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 mb-8">
          <strong>Not legal advice.</strong> This page is general information
          for the public. It is not a substitute for advice from a licensed
          Nevada attorney about your specific matter.
        </div>

        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200">
          {FAQS.map((item, i) => (
            <details
              key={i}
              className="group p-5 sm:p-6"
              {...(i === 0 ? { open: true } : {})}
            >
              <summary className="flex items-start justify-between gap-4 cursor-pointer list-none">
                <h2 className="text-base sm:text-lg font-semibold text-[#0f1e3c] leading-snug">
                  {item.q}
                </h2>
                <span
                  className="text-amber-600 font-bold text-xl leading-none mt-0.5 group-open:rotate-45 transition-transform"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <div className="mt-3 text-sm text-gray-700 leading-relaxed space-y-3">
                {item.body}
              </div>
            </details>
          ))}
        </div>

        <div className="mt-10 bg-[#0f1e3c] text-white rounded-2xl p-8 sm:p-10 text-center">
          <ShieldCheck className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <h2 className="text-xl sm:text-2xl font-bold mb-2">
            Ready to post a job in Nevada?
          </h2>
          <p className="text-sm text-white/70 leading-relaxed max-w-lg mx-auto">
            NV PILB-registered servers · GPS-verified attempts · NRS 53.045-compliant
            affidavits delivered the moment service is complete.
          </p>
          <div className="mt-5 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-[#0f1e3c] font-bold text-sm transition-colors"
            >
              <FileText className="w-4 h-4" />
              Get started
            </Link>
            <a
              href="tel:+17756553933"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-semibold text-sm transition-colors border border-white/15"
            >
              <Phone className="w-4 h-4" />
              (775) 655-3933
            </a>
          </div>
        </div>

        <footer className="text-center text-xs text-gray-500 mt-8">
          <Link href="/privacy" className="hover:underline mr-3">
            Privacy
          </Link>
          <span>·</span>
          <Link href="/terms" className="hover:underline mx-3">
            Terms
          </Link>
          <span>·</span>
          <Link href="/" className="hover:underline ml-3">
            Home
          </Link>
        </footer>
      </main>
    </div>
  );
}
