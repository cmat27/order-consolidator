import { describe, it, expect } from 'vitest';
import { normalizeAddress } from '@/lib/normalize-address';

describe('normalizeAddress', () => {
  it('standardizes street suffixes, apartment prefixes, punctuation, and case', () => {
    const addr1 = {
      address1: '123 Main Street.',
      address2: 'Apartment 4B',
      city: 'New York',
      province_code: 'NY',
      zip: '10001-1234',
      country_code: 'US',
    };

    const addr2 = {
      address1: '123 main st',
      address2: 'apt 4b',
      city: 'new   york',
      province_code: 'ny',
      zip: '10001',
      country_code: 'us',
    };

    expect(normalizeAddress(addr1)).toBe(normalizeAddress(addr2));
    expect(normalizeAddress(addr1)).toBe('123 main st|apt 4b|new york|ny|10001|us');
  });

  it('standardizes road, avenue, boulevard, and suite abbreviations', () => {
    const addr1 = {
      address1: '450 Sunset Boulevard, North Road & 5th Avenue',
      address2: 'Suite 200',
      city: 'Los Angeles',
      province_code: 'CA',
      zip: '90028',
      country_code: 'US',
    };

    const addr2 = {
      address1: '450 sunset blvd north rd 5th ave',
      address2: 'ste 200',
      city: 'los angeles',
      province_code: 'ca',
      zip: '90028 9999',
      country_code: 'us',
    };

    expect(normalizeAddress(addr1)).toBe(normalizeAddress(addr2));
  });

  it('handles missing optional fields gracefully', () => {
    expect(normalizeAddress({})).toBe('|||||');
  });
});
