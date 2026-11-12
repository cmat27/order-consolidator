export interface ShippingAddress {
  address1?: string;
  address2?: string;
  city?: string;
  province_code?: string;
  zip?: string;
  country_code?: string;
}

export function normalizeAddress(addr: ShippingAddress): string {
  const clean = (val?: string) =>
    (val || '')
      .toLowerCase()
      .replace(/[^\w\s]/gi, '')
      .replace(/\bstreet\b/g, 'st')
      .replace(/\broad\b/g, 'rd')
      .replace(/\bavenue\b/g, 'ave')
      .replace(/\bboulevard\b/g, 'blvd')
      .replace(/\bapartment\b/g, 'apt')
      .replace(/\bsuite\b/g, 'ste')
      .replace(/\s+/g, ' ')
      .trim();

  const zip = (addr.zip || '').replace(/\s+/g, '').slice(0, 5);
  return `${clean(addr.address1)}|${clean(addr.address2)}|${clean(addr.city)}|${clean(addr.province_code)}|${zip}|${clean(addr.country_code)}`;
}
