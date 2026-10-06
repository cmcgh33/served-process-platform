import { Link } from "wouter";
import { useSeo } from "@/lib/useSeo";
import { ArrowLeft } from "lucide-react";

const EFFECTIVE_DATE = "May 9, 2026";

export default function PrivacyPage() {
  useSeo({
    title: "Privacy Policy — SERVED.",
    description:
      "How SERVED. collects, uses, and protects information when you use our process serving platform.",
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
            Privacy Policy
          </h1>
          <p className="text-sm text-gray-500 mb-8">
            Effective {EFFECTIVE_DATE}
          </p>

          <Section title="1. Who we are">
            <p>
              SERVED. ("SERVED.", "we", "us", or "our") operates a digital
              platform that connects individuals and law firms (
              <strong>requesters</strong>) with licensed and registered process
              servers (<strong>servers</strong>) for the purpose of legal
              document service. SERVED. is operated from Nevada, United States.
              Contact us at{" "}
              <a
                href="mailto:info@servedapp.co"
                className="text-blue-600 hover:underline"
              >
                info@servedapp.co
              </a>
              .
            </p>
          </Section>

          <Section title="2. Information we collect">
            <p>
              We collect the following categories of information when you use
              the SERVED. platform:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li>
                <strong>Account information.</strong> Name, email address,
                phone number, role (individual, attorney, server, admin), and
                authentication credentials managed by our identity provider
                (Clerk).
              </li>
              <li>
                <strong>Job and matter details.</strong> Recipient name and
                service address, court and case information, document type and
                description, requesting party details, and any uploaded
                documents you store in our Cloud Vault.
              </li>
              <li>
                <strong>Server credentials.</strong> Process server license
                number, license expiration, jurisdiction, server type
                classification, background check results returned by Certn,
                and Stripe Connect onboarding information.
              </li>
              <li>
                <strong>Service evidence.</strong> GPS coordinates and accuracy
                metadata captured at the time of attempted or completed service,
                photographs uploaded by servers, identity-verification method,
                signature images, and timestamps.
              </li>
              <li>
                <strong>Payment information.</strong> Card payments and
                subscription billing are processed by Stripe, Inc. SERVED. does
                not store full card numbers; we retain a token, the last four
                digits, and transaction metadata.
              </li>
              <li>
                <strong>Usage and device data.</strong> IP address, browser type
                and version, pages viewed, referring URL, and timestamps. We
                use these to operate, secure, and improve the platform.
              </li>
            </ul>
          </Section>

          <Section title="3. How we use information">
            <ul className="list-disc pl-6 space-y-2">
              <li>To create and authenticate user accounts.</li>
              <li>
                To match jobs with eligible servers and to dispatch, track, and
                document service of process.
              </li>
              <li>
                To generate court-ready affidavits and Notices of Service by
                Mail under NRCP 4.2(a)(2) and NRS 53.045.
              </li>
              <li>
                To process subscription billing, per-job payments, and server
                payouts via Stripe Connect.
              </li>
              <li>
                To send transactional notifications (job assignment, mark-served
                receipts, payout failures, license expiry warnings) by email
                via SendGrid and, where applicable, SMS via Twilio.
              </li>
              <li>
                To investigate fraud, abuse, or violations of our Terms of
                Service, and to comply with subpoenas, court orders, or other
                lawful requests.
              </li>
            </ul>
          </Section>

          <Section title="4. How we share information">
            <p>We share information only as follows:</p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li>
                <strong>Between requester and assigned server</strong>, to the
                extent necessary to perform service of process. Requesters see
                limited server information (name, license, rating). Servers see
                job details necessary to perform service.
              </li>
              <li>
                <strong>Service providers</strong> acting on our behalf: Clerk
                (authentication), Stripe (payments), Certn (background checks),
                SendGrid (email), Twilio (SMS), Replit Object Storage (document
                and affidavit storage), and our cloud infrastructure provider.
                Each is bound by contractual confidentiality and data-protection
                obligations.
              </li>
              <li>
                <strong>Courts, opposing counsel, and the public record.</strong>{" "}
                Affidavits of service are filed with courts and become part of
                the public court record. By using SERVED., you understand that
                completed affidavits and accompanying notices may be filed
                publicly.
              </li>
              <li>
                <strong>Legal compliance.</strong> When required by law,
                subpoena, court order, or to protect the rights, property, or
                safety of SERVED., our users, or the public.
              </li>
              <li>
                <strong>Business transfers.</strong> If SERVED. is acquired,
                merged, or sells substantially all of its assets, user
                information may transfer to the successor.
              </li>
            </ul>
            <p className="mt-3">
              <strong>We do not sell or rent personal information.</strong>
            </p>
          </Section>

          <Section title="5. Data retention">
            <p>
              We retain account information for as long as your account is
              active and for a reasonable period thereafter to comply with
              legal, accounting, and audit obligations. Service evidence
              (affidavits, GPS, photographs, and attempt history) is retained
              indefinitely as part of the legal record because process-of-
              service documentation may be required for years after the
              underlying matter concludes. You may request deletion of your
              account at any time by emailing{" "}
              <a
                href="mailto:info@servedapp.co"
                className="text-blue-600 hover:underline"
              >
                info@servedapp.co
              </a>
              ; service-evidence records that have been filed with a court or
              that are subject to a litigation hold cannot be deleted.
            </p>
          </Section>

          <Section title="6. Security">
            <p>
              We use industry-standard safeguards including TLS encryption in
              transit, encrypted storage at rest, role-based access control,
              audit logging of administrative actions, and presigned URLs for
              document access. No system is perfectly secure; you use SERVED.
              at your own risk.
            </p>
          </Section>

          <Section title="7. Your rights">
            <p>
              Depending on your jurisdiction, you may have the right to access,
              correct, delete, or export your personal information, or to
              object to certain processing. To exercise any of these rights,
              email{" "}
              <a
                href="mailto:info@servedapp.co"
                className="text-blue-600 hover:underline"
              >
                info@servedapp.co
              </a>{" "}
              from the address on file with your account. We will respond
              within 30 days.
            </p>
          </Section>

          <Section title="8. Children">
            <p>
              SERVED. is not directed to children under 18 and we do not
              knowingly collect information from anyone under 18. If you
              believe a minor has provided information to us, contact us so we
              can delete it.
            </p>
          </Section>

          <Section title="9. Cookies">
            <p>
              We use strictly-necessary cookies to maintain your session and
              authenticate you. We do not use advertising or third-party
              tracking cookies.
            </p>
          </Section>

          <Section title="10. Changes to this policy">
            <p>
              We may update this Privacy Policy from time to time. Material
              changes will be communicated by email to active users at least
              14 days before they take effect.
            </p>
          </Section>

          <Section title="11. Contact">
            <p>
              Questions or requests:{" "}
              <a
                href="mailto:info@servedapp.co"
                className="text-blue-600 hover:underline"
              >
                info@servedapp.co
              </a>
              .
            </p>
          </Section>
        </div>

        <footer className="text-center text-xs text-gray-500 mt-8">
          <Link href="/terms" className="hover:underline mr-3">
            Terms of Service
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
