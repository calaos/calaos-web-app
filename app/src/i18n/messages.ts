// The catalogues as the app loads them: the main file of each locale, with
// each admin feature's own file under `admin.<feature>`, so that features
// translated in parallel never edit the same file.

import en from './en.json';
import fr from './fr.json';
import configEn from './admin/config.en.json';
import configFr from './admin/config.fr.json';
import logsEn from './admin/logs.en.json';
import logsFr from './admin/logs.fr.json';
import networkEn from './admin/network.en.json';
import networkFr from './admin/network.fr.json';
import servicesEn from './admin/services.en.json';
import servicesFr from './admin/services.fr.json';
import timeEn from './admin/time.en.json';
import timeFr from './admin/time.fr.json';

export const messages = {
    en: {
        ...en,
        admin: { ...en.admin, services: servicesEn, logs: logsEn, time: timeEn, config: configEn, network: networkEn },
    },
    fr: {
        ...fr,
        admin: { ...fr.admin, services: servicesFr, logs: logsFr, time: timeFr, config: configFr, network: networkFr },
    },
};
