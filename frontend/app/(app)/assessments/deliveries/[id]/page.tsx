import { redirect } from 'next/navigation';

/**
 * Legacy URL used in older assessment notification emails.
 * Permanently redirect to the proper take-test flow.
 */
export default function AssessmentDeliveryRedirectPage({ params }: { params: { id: string } }) {
  redirect(`/assessments/take/${params.id}`);
}
