import { msg } from '@nb/i18n';

/**
 * The text the desktop app's main process shows (apps/desktop/src: `t('…')`), in the interface
 * language, keyed by its English. The main process cannot load the catalogs itself, so the page sends
 * this table once it has chosen its language. mainStrings.test.ts checks that every `t('…')` is here.
 */
export function mainProcessStrings(): Record<string, string> {
  return {
    'Open': msg('Open'),
    'Save': msg('Save'),
    'All files': msg('All files'),
    'Pictures': msg('Pictures'),
    'PDF, pictures and drawings': msg('PDF, pictures and drawings'),
    'PDF and pictures': msg('PDF and pictures'),
    'DWG and DXF drawings': msg('DWG and DXF drawings'),
    'Excel Workbook': msg('Excel Workbook'),
    'Choose the card’s PKCS#11 driver': msg('Choose the card’s PKCS#11 driver'),
    'PKCS#11 driver': msg('PKCS#11 driver'),
    'Open a Project folder': msg('Open a Project folder'),
    'Choose where the Project folder goes': msg('Choose where the Project folder goes'),
    'Open a Live Session folder': msg('Open a Live Session folder'),
    'Choose a shared folder for the Live Session': msg('Choose a shared folder for the Live Session'),
    'Choose where the Excel workbook goes': msg('Choose where the Excel workbook goes'),
    'Choose the client’s register file': msg('Choose the client’s register file'),
    'Save the filled-in register': msg('Save the filled-in register'),
    'Sign-in did not finish.': msg('Sign-in did not finish.'),
    'Sign-in complete.': msg('Sign-in complete.'),
    'You can close this window and return to redcolumn.': msg('You can close this window and return to redcolumn.'),
  };
}
