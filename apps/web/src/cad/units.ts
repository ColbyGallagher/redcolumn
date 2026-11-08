/**
 * Drawing units a person can pick for a drawing that does not say its own ($INSUNITS 0). Codes are
 * AutoCAD's INSUNITS values. Light: the app imports this without the converter.
 */
export const UNIT_CHOICES: { code: number; label: string }[] = [
  { code: 4, label: 'Millimetres: 1 drawing unit is 1 mm' },
  { code: 5, label: 'Centimetres: 1 drawing unit is 1 cm' },
  { code: 6, label: 'Metres: 1 drawing unit is 1 m' },
  { code: 7, label: 'Kilometres: 1 drawing unit is 1 km' },
  { code: 1, label: 'Inches: 1 drawing unit is 1 in' },
  { code: 2, label: 'Feet: 1 drawing unit is 1 ft' },
  { code: 21, label: 'US survey feet: 1 drawing unit is 1 US survey ft' },
  { code: 10, label: 'Yards: 1 drawing unit is 1 yd' },
  { code: 3, label: 'Miles: 1 drawing unit is 1 mi' },
];

export const unitName = (code: number) => UNIT_CHOICES.find((u) => u.code === code)?.label.split(':')[0]?.toLowerCase() ?? 'unknown units';
