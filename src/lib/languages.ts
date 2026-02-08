import type { Language } from './types';

export const LANGUAGES: Language[] = [
  { code: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी', script: 'अ' },
  { code: 'en-IN', name: 'English', nativeName: 'English', script: 'A' },
  { code: 'bn-IN', name: 'Bengali', nativeName: 'বাংলা', script: 'অ' },
  { code: 'ta-IN', name: 'Tamil', nativeName: 'தமிழ்', script: 'அ' },
  { code: 'te-IN', name: 'Telugu', nativeName: 'తెలుగు', script: 'అ' },
  { code: 'mr-IN', name: 'Marathi', nativeName: 'मराठी', script: 'अ' },
  { code: 'gu-IN', name: 'Gujarati', nativeName: 'ગુજરાતી', script: 'અ' },
  { code: 'kn-IN', name: 'Kannada', nativeName: 'ಕನ್ನಡ', script: 'ಅ' },
  { code: 'ml-IN', name: 'Malayalam', nativeName: 'മലയാളം', script: 'അ' },
  { code: 'pa-IN', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', script: 'ਅ' },
  { code: 'od-IN', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', script: 'ଅ' },
  { code: 'as-IN', name: 'Assamese', nativeName: 'অসমীয়া', script: 'অ' },
  { code: 'ur-IN', name: 'Urdu', nativeName: 'اردو', script: 'ا' },
  { code: 'sa-IN', name: 'Sanskrit', nativeName: 'संस्कृतम्', script: 'अ' },
  { code: 'ne-IN', name: 'Nepali', nativeName: 'नेपाली', script: 'अ' },
  { code: 'doi-IN', name: 'Dogri', nativeName: 'डोगरी', script: 'अ' },
  { code: 'brx-IN', name: 'Bodo', nativeName: 'बड़ो', script: 'अ' },
  { code: 'kok-IN', name: 'Konkani', nativeName: 'कोंकणी', script: 'अ' },
  { code: 'mai-IN', name: 'Maithili', nativeName: 'मैथिली', script: 'अ' },
  { code: 'sd-IN', name: 'Sindhi', nativeName: 'سنڌي', script: 'س' },
  { code: 'ks-IN', name: 'Kashmiri', nativeName: 'कॉशुर', script: 'अ' },
  { code: 'mni-IN', name: 'Manipuri', nativeName: 'মণিপুরী', script: 'ম' },
  { code: 'sat-IN', name: 'Santali', nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ', script: 'ᱚ' },
];

export const SOURCE_LANGUAGES: Language[] = [
  { code: 'auto', name: 'Auto-detect', nativeName: 'Auto', script: '?' },
  ...LANGUAGES,
];
