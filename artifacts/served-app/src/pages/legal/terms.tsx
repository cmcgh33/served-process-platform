import { Link } from "wouter";
import { useSeo } from "@/lib/useSeo";
import { ArrowLeft } from "lucide-react";

const EFFECTIVE_DATE = "May 9, 2026";

export default function TermsPage() {
  useSeo({
    title: "Terms of Service — SERVED.",
    description:
      "Terms governing your use of the SERVED. process serving platform.",
  });

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
        <div className="bg-white rounded-xl border border-gray-200 p-8 sm:p-10">
          <h1 className="text-3xl font-bold text-[#0f1e3c] mb-2">
            Terms of Service
          </h1>
          <p className="text-sm text-gray-500 mb-8">
            Effective {EFFECTIVE_DATE}
          </p>

          <Section title="1. Acceptance">
            <p>
              These Terms of Service ("Terms") govern your access to and use of
              the SERVED. platform, websites, and related services (the
              "Service") operated by SERVED. ("SERVED.", "we", "us"). By
              creating an account or using the Service, you agree to be bound
              by these Terms. If you do not agree, do not use the Service.
            </p>
          </Section>

          <Section title="2. What SERVED. is — and is not">
            <p>
              SERVED. is a technology platform that connects requesters of
              process service with independent process servers, processes
              payments, and generates court-ready documentation. SERVED. is
              <strong> not</strong> a law firm, does not provide legal advice,
              and is not party to any attorney–client relationship. The
              process servers who accept jobs through SERVED. are{" "}
              <strong>independent contractors</strong>, not employees or
              agents of SERVED.
            </p>
          </Section>

          <Section title="3. Eligibility">
            <ul className="list-disc pl-6 space-y-2">
              <li>
                You must be at least 18 years old and able to form a binding
                contract.
              </li>
              <li>
                <strong>Servers</strong> must hold all licenses and
                registrations required by the jurisdictions in which they
                serve, must pass a background check through our credentialing
                partner (Certn), and must keep their license information
                current. In Nevada, servers must be licensed by the Nevada
                Private Investigators Licensing Board (PILB) or fall under a
                statutory exception (sheriff, deputized constable, or other
                authorized person under NRS Chapter 14).
              </li>
              <li>
                <strong>Attorneys</strong> using the ProServe portal represent
                that they are authorized to practice law in the jurisdiction
                of any matter posted.
              </li>
            </ul>
          </Section>

          <Section title="4. Account responsibility">
            <p>
              You are responsible for maintaining the confidentiality of your
              login credentials and for all activity under your account.
              Notify us immediately at{" "}
              <a
                href="mailto:info@servedapp.co"
                className="text-blue-600 hover:underline"
              >
                info@servedapp.co
              </a>{" "}
              of any unauthorized access.
            </p>
          </Section>

          <Section title="5. Fees, payments, and payouts">
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Per-job fees, subscription pricing, and rush surcharges are
                presented at the time of posting and are charged via Stripe.
              </li>
              <li>
                Servers receive 80% of the per-job fee; SERVED. retains 20%
                as a platform fee. Payouts are issued via Stripe Connect on a
                weekly schedule (Friday) by default; servers may trigger an
                instant payout from their wallet. Standard Stripe Connect
                payout timing rules apply.
              </li>
              <li>
                Subscription plans renew automatically until cancelled. You
                may cancel at any time from your subscription page; the
                cancellation takes effect at the end of the current billing
                period.
              </li>
              <li>
                <strong>Refunds.</strong> Once a server has accepted a job,
                fees are generally non-refundable. We may, at our sole
                discretion, issue a partial refund for jobs that cannot be
                served due to platform error.
              </li>
            </ul>
          </Section>

          <Section title="6. Service of process — disclaimers">
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Service of process is governed by court rules and statutes
                that vary by jurisdiction. You are responsible for ensuring
                that the address, recipient, court information, and document
                type you provide are accurate and that service through
                SERVED. satisfies the requirements applicable to your matter.
              </li>
              <li>
                Servers exercise independent professional judgment in
                attempting service. SERVED. does not guarantee that any
                particular attempt will result in successful personal,
                substitute, mail, posting, or publication service.
              </li>
              <li>
                <strong>Affidavits</strong> generated by SERVED. are based on
                evidence submitted by the assigned server (GPS, photographs,
                identity-verification method, attempt notes, and signature)
                and contain a declaration under penalty of perjury pursuant to
                NRS 53.045. The accuracy of the underlying statements is the
                responsibility of the signing server.
              </li>
            </ul>
          </Section>

          <Section title="7. Acceptable use">
            <p>You agree NOT to:</p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li>
                Use the Service to harass, threaten, defraud, or stalk any
                person.
              </li>
              <li>
                Submit false service information, falsify evidence, or
                misrepresent your identity, license status, or jurisdiction.
              </li>
              <li>
                Reverse engineer, scrape, or interfere with the Service or
                attempt to gain unauthorized access to any portion of it.
              </li>
              <li>
                Use the Service to violate any applicable law, court rule, or
                third-party right.
              </li>
            </ul>
            <p className="mt-3">
              We may suspend or terminate any account that violates these
              Terms, with or without notice.
            </p>
          </Section>

          <Section title="8. Cloud Vault and document storage">
            <p>
              The Cloud Vault feature allows attorneys and requesters to
              upload and store documents related to their matters. You
              represent that you have the right to upload any document you
              submit and that it does not infringe any third party's rights.
              SERVED. does not review the content of uploaded documents and is
              not responsible for their accuracy or legality. Storage quotas
              are set by your subscription tier.
            </p>
          </Section>

          <Section title="9. Intellectual property">
            <p>
              SERVED. and its licensors retain all rights in the Service,
              including software, branding, and platform-generated documents
              such as affidavits and notices. You retain ownership of any
              content you upload (such as documents to be served) and grant
              SERVED. a limited license to host, transmit, and display that
              content as necessary to provide the Service.
            </p>
          </Section>

          <Section title="10. Disclaimer of warranties">
            <p>
              THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT
              WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
              LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
              PARTICULAR PURPOSE, AND NON-INFRINGEMENT. SERVED. DOES NOT
              WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR
              SECURE.
            </p>
          </Section>

          <Section title="11. Limitation of liability">
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, SERVED. AND ITS
              OFFICERS, EMPLOYEES, AND AFFILIATES SHALL NOT BE LIABLE FOR ANY
              INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
              DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR GOODWILL, ARISING OUT
              OF OR IN CONNECTION WITH YOUR USE OF THE SERVICE. SERVED.'S
              TOTAL LIABILITY FOR ANY CLAIM SHALL NOT EXCEED THE GREATER OF
              (a) THE AMOUNTS YOU PAID TO SERVED. IN THE TWELVE MONTHS
              PRECEDING THE CLAIM OR (b) ONE HUNDRED U.S. DOLLARS ($100).
            </p>
          </Section>

          <Section title="12. Indemnification">
            <p>
              You agree to indemnify and hold harmless SERVED. from any
              claim, demand, loss, or expense (including reasonable attorneys'
              fees) arising out of (a) your use of the Service, (b) your
              breach of these Terms, (c) your violation of any law or
              third-party right, or (d) any false or misleading information
              you submit through the Service.
            </p>
          </Section>

          <Section title="13. Governing law and disputes">
            <p>
              These Terms are governed by the laws of the State of Nevada,
              without regard to its conflict-of-laws principles. Any dispute
              arising out of or relating to these Terms or the Service shall
              be resolved exclusively in the state or federal courts located
              in Clark County, Nevada, and you consent to the personal
              jurisdiction and venue of those courts.
            </p>
          </Section>

          <Section title="14. Changes to these Terms">
            <p>
              We may update these Terms from time to time. Material changes
              will be communicated by email to active users at least 14 days
              before they take effect. Continued use of the Service after the
              effective date of an update constitutes acceptance of the
              updated Terms.
            </p>
          </Section>

          <Section title="15. Contact">
            <p>
              SERVED. ·{" "}
              <a
                href="mailto:info@servedapp.co"
                className="text-blue-600 hover:underline"
              >
                info@servedapp.co
              </a>
            </p>
          </Section>
        </div>

        <footer className="text-center text-xs text-gray-500 mt-8">
          <Link href="/privacy" className="hover:underline mr-3">
            Privacy Policy
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <h2 className="text-lg font-bold text-[#0f1e3c] mb-3">{title}</h2>
      <div className="text-sm text-gray-700 leading-relaxed space-y-3">
        {children}
      </div>
    </section>
  );
}
