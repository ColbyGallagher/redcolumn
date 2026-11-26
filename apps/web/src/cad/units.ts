import { msg } from '@nb/i18n';
/**
 * Drawing units a person can pick for a drawing that does not say its own ($INSUNITS 0). Codes are
 * AutoCAD's INSUNITS values. Light: the app imports this without the converter.
 */
export const UNIT_CHOICES: { code: number; label: string }[] = [
  { code: 4, get label() { return msg('Millimetres: 1 drawing unit is 1 mm'); } },
  { code: 5, get label() { return msg('Centimetres: 1 drawing unit is 1 cm'); } },
  { code: 6, get label() { return msg('Metres: 1 drawing unit is 1 m'); } },
  { code: 7, get label() { return msg('Kilometres: 1 drawing unit is 1 km'); } },
  { code: 1, get label() { return msg('Inches: 1 drawing unit is 1 in'); } },
  { code: 2, get label() { return msg('Feet: 1 drawing unit is 1 ft'); } },
  { code: 21, get label() { return msg('US survey feet: 1 drawing unit is 1 US survey ft'); } },
  { code: 10, get label() { return msg('Yards: 1 drawing unit is 1 yd'); } },
  { code: 3, get label() { return msg('Miles: 1 drawing unit is 1 mi'); } },
];

export const unitName = (code: number) => UNIT_CHOICES.find((u) => u.code === code)?.label.split(':')[0]?.toLowerCase() ?? 'unknown units';
