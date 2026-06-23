import * as Localization from 'expo-localization';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import resources from './translations';
import brand from '../brand/brand.config';

const SUPPORTED_LANGUAGES = Object.keys(resources);

const getDeviceLanguage = () => {
  const locales = Localization.getLocales();
  if (locales && locales.length > 0) {
    const code = locales[0].languageCode;
    if (SUPPORTED_LANGUAGES.includes(code)) {
      return code;
    }
  }
  return brand.defaultLanguage;
};

i18next.use(initReactI18next).init({
  resources,
  lng: getDeviceLanguage(),
  fallbackLng: brand.fallbackLanguages || [brand.defaultLanguage],
  interpolation: {
    escapeValue: false,
  },
});

export default i18next;
