/**
 * Partner profiles for the conversion.
 *
 * Data lives in partners.json (also read by backend/convert_local.py);
 * logos live in public/partners/. A new partner is added there, not in the UI.
 */

import partnerData from './partners.json';

export interface PartnerProfile {
  id: string;
  name: string;
  address: string[];
  phone: string;
  email?: string;
  web?: string;
  /** Path below public/, e.g. /partners/jermann.png (PNG or JPEG) */
  logo: string;
}

export const PARTNERS: PartnerProfile[] = partnerData;
