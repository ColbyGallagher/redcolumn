import { BitReader, R2004, R2007, R2010, R2013, R2018, stringStream } from './bits';

/**
 * The header variables a plot needs, read by walking the AcDb:Header section in its fixed order
 * (ODA spec 9). Everything before INSUNITS has to be stepped over.
 */
export interface DwgHeader {
  ltscale: number;
  textsize: number;
  /** PSLTSCALE: paper-space linetype scaling. */
  psltscale: boolean;
  insunits: number;
}

export function readHeader(data: Uint8Array, version: number, maintenance: number, decoder: TextDecoder): DwgHeader {
  const out: DwgHeader = { ltscale: 1, textsize: 2.5, psltscale: true, insunits: 0 };
  const r = new BitReader(data, version, decoder);
  r.sentinel();
  r.RL(); // size
  if ((version >= R2010 && maintenance > 3) || version >= R2018) r.RL();
  const initial = r.pos;
  let t: BitReader = r;
  let h: BitReader = r;
  if (version >= R2007) {
    const bits = r.RL();
    const last = initial + bits - 1;
    t = stringStream(r, last) ?? r.clone(r.end);
    h = r.clone(last + 1);
  }
  const TV = () => (version >= R2007 && t.pos >= t.end ? '' : t.TV());
  const H = () => h.H();

  if (version >= R2013) r.BLL();
  r.BD();
  r.BD();
  r.BD();
  r.BD();
  TV();
  TV();
  TV();
  TV();
  r.BL();
  r.BL();
  if (version < R2004) H(); // viewport
  r.B(); // DIMASO
  r.B(); // DIMSHO
  r.B(); // PLINEGEN
  r.B(); // ORTHOMODE
  r.B(); // REGENMODE
  r.B(); // FILLMODE
  r.B(); // QTEXTMODE
  out.psltscale = r.B() === 1;
  r.B(); // LIMCHECK
  if (version >= R2004) r.B();
  r.B(); // USRTIMER
  r.B(); // SKPOLY
  r.B(); // ANGDIR
  r.B(); // SPLFRAME
  r.B(); // MIRRTEXT
  r.B(); // WORLDVIEW
  r.B(); // TILEMODE
  r.B(); // PLIMCHECK
  r.B(); // VISRETAIN
  r.B(); // DISPSILH
  r.B(); // PELLIPSE
  r.BS(); // PROXYGRAPHICS
  r.BS(); // TREEDEPTH
  r.BS(); // LUNITS
  r.BS(); // LUPREC
  r.BS(); // AUNITS
  r.BS(); // AUPREC
  r.BS(); // ATTMODE
  r.BS(); // PDMODE
  if (version >= R2004) {
    r.BL();
    r.BL();
    r.BL();
  }
  for (let i = 0; i < 5; i++) r.BS(); // USERI1-5
  r.BS(); // SPLINESEGS
  r.BS(); // SURFU
  r.BS(); // SURFV
  r.BS(); // SURFTYPE
  r.BS(); // SURFTAB1
  r.BS(); // SURFTAB2
  r.BS(); // SPLINETYPE
  r.BS(); // SHADEDGE
  r.BS(); // SHADEDIF
  r.BS(); // UNITMODE
  r.BS(); // MAXACTVP
  r.BS(); // ISOLINES
  r.BS(); // CMLJUST
  r.BS(); // TEXTQLTY
  out.ltscale = r.BD() || 1;
  out.textsize = r.BD() || 2.5;
  r.BD(); // TRACEWID
  r.BD(); // SKETCHINC
  r.BD(); // FILLETRAD
  r.BD(); // THICKNESS
  r.BD(); // ANGBASE
  r.BD(); // PDSIZE
  r.BD(); // PLINEWID
  for (let i = 0; i < 5; i++) r.BD(); // USERR1-5
  r.BD(); // CHAMFERA
  r.BD(); // CHAMFERB
  r.BD(); // CHAMFERC
  r.BD(); // CHAMFERD
  r.BD(); // FACETRES
  r.BD(); // CMLSCALE
  r.BD(); // CELTSCALE
  TV(); // MENUNAME
  r.BL();
  r.BL(); // TDCREATE
  r.BL();
  r.BL(); // TDUPDATE
  if (version >= R2004) {
    r.BL();
    r.BL();
    r.BL();
  }
  r.BL();
  r.BL(); // TDINDWG
  r.BL();
  r.BL(); // TDUSRTIMER
  r.CMC(t); // CECOLOR
  r.H(); // HANDSEED (main stream)
  H(); // CLAYER
  H(); // TEXTSTYLE
  H(); // CELTYPE
  if (version >= R2007) H(); // CMATERIAL
  H(); // DIMSTYLE
  H(); // CMLSTYLE
  r.BD(); // PSVPSCALE
  r.BD3(); // INSBASE (PS)
  r.BD3(); // EXTMIN
  r.BD3(); // EXTMAX
  r.RD2(); // LIMMIN
  r.RD2(); // LIMMAX
  r.BD(); // ELEVATION
  r.BD3(); // UCSORG
  r.BD3(); // UCSXDIR
  r.BD3(); // UCSYDIR
  H(); // UCSNAME
  H(); // PUCSORTHOREF
  r.BS(); // PUCSORTHOVIEW
  H(); // PUCSBASE
  for (let i = 0; i < 6; i++) r.BD3();
  r.BD3(); // INSBASE (MS)
  r.BD3();
  r.BD3();
  r.RD2();
  r.RD2();
  r.BD();
  r.BD3();
  r.BD3();
  r.BD3();
  H(); // UCSNAME
  H(); // UCSORTHOREF
  r.BS(); // UCSORTHOVIEW
  H(); // UCSBASE
  for (let i = 0; i < 6; i++) r.BD3();
  TV(); // DIMPOST
  TV(); // DIMAPOST
  for (let i = 0; i < 9; i++) r.BD(); // DIMSCALE … DIMTM
  if (version >= R2007) {
    r.BD(); // DIMFXL
    r.BD(); // DIMJOGANG
    r.BS(); // DIMTFILL
    r.CMC(t); // DIMTFILLCLR
  }
  for (let i = 0; i < 6; i++) r.B(); // DIMTOL … DIMSE2
  r.BS(); // DIMTAD
  r.BS(); // DIMZIN
  r.BS(); // DIMAZIN
  if (version >= R2007) r.BS(); // DIMARCSYM
  for (let i = 0; i < 8; i++) r.BD(); // DIMTXT … DIMGAP
  r.BD(); // DIMALTRND
  r.B(); // DIMALT
  r.BS(); // DIMALTD
  r.B(); // DIMTOFL
  r.B(); // DIMSAH
  r.B(); // DIMTIX
  r.B(); // DIMSOXD
  r.CMC(t); // DIMCLRD
  r.CMC(t); // DIMCLRE
  r.CMC(t); // DIMCLRT
  for (let i = 0; i < 11; i++) r.BS(); // DIMADEC … DIMJUST
  r.B(); // DIMSD1
  r.B(); // DIMSD2
  r.BS(); // DIMTOLJ
  r.BS(); // DIMTZIN
  r.BS(); // DIMALTZ
  r.BS(); // DIMALTTZ
  r.B(); // DIMUPT
  r.BS(); // DIMATFIT
  if (version >= R2007) r.B(); // DIMFXLON
  if (version >= R2010) {
    r.B(); // DIMTXTDIRECTION
    r.BD(); // DIMALTMZF
    TV(); // DIMALTMZS
    r.BD(); // DIMMZF
    TV(); // DIMMZS
  }
  for (let i = 0; i < 5; i++) H(); // DIMTXSTY … DIMBLK2
  if (version >= R2007) for (let i = 0; i < 3; i++) H(); // DIMLTYPE, DIMLTEX1, DIMLTEX2
  r.BS(); // DIMLWD
  r.BS(); // DIMLWE
  for (let i = 0; i < 9; i++) H(); // table control objects
  if (version === 1015) H(); // VIEWPORT ENTITY HEADER control
  H(); // ACAD_GROUP
  H(); // ACAD_MLINESTYLE
  H(); // named objects
  r.BS(); // TSTACKALIGN
  r.BS(); // TSTACKSIZE
  TV(); // HYPERLINKBASE
  TV(); // STYLESHEET
  H(); // LAYOUTS
  H(); // PLOTSETTINGS
  H(); // PLOTSTYLES
  if (version >= R2004) {
    H(); // MATERIALS
    H(); // COLORS
  }
  if (version >= R2007) {
    H(); // VISUALSTYLE
    if (version >= R2013) H();
  }
  r.BL(); // flags (CELWEIGHT, ENDCAPS, …)
  out.insunits = r.BS();
  return out;
}
