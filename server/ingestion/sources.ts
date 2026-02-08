export interface NewspaperSource {
  name: string;
  region: string;
  language: string;
  url: string;
}

// Placeholder config — replace URLs with actual e-paper PDF endpoints
export const SOURCES: NewspaperSource[] = [
  {
    name: 'Kannada Prabha',
    region: 'Karnataka',
    language: 'kn-IN',
    url: 'PLACEHOLDER_URL',
  },
  {
    name: 'Loksatta',
    region: 'Maharashtra',
    language: 'mr-IN',
    url: 'PLACEHOLDER_URL',
  },
  {
    name: 'Dinamani',
    region: 'Tamil Nadu',
    language: 'ta-IN',
    url: 'PLACEHOLDER_URL',
  },
];

export const REGIONS = [
  { code: 'Karnataka', name: 'Karnataka', languages: ['kn-IN'] },
  { code: 'Maharashtra', name: 'Maharashtra', languages: ['mr-IN'] },
  { code: 'Tamil Nadu', name: 'Tamil Nadu', languages: ['ta-IN'] },
];
