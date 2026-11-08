// Complete DXF R2010 (AC1024) document writer.
//
// AutoCAD / Creo require more than an ENTITIES section for R2000+ files:
// every object needs a unique handle (group 5) and an owner (group 330), and
// the TABLES, BLOCKS (*Model_Space / *Paper_Space) and OBJECTS (root
// dictionary, ACAD_GROUP, ACAD_LAYOUT with Model/Layout1) structures must be
// present. The skeleton mirrors what ezdxf writes for a new R2010 drawing.
//
// Usage: const doc = dxfDocument({ ltypes, layers }); doc.put(0, 'LINE', ...);
// doc.toString(). Entity pairs are streamed through put(); each `0, TYPE`
// receives its handle and model-space owner automatically.

const hex = n => n.toString(16).toUpperCase();

export const CONTINUOUS = 'Continuous';
export const CENTER_LTYPE = {
  name: 'CENTER',
  description: 'Center: long dash, gap, short dash, gap',
  pattern: [2.4, -0.6, 0.4, -0.6],
};

export function dxfDocument({ ltypes = [], layers = [] } = {}) {
  let next = 1;
  const handle = () => hex(next++);
  const entities = [];
  const pairs = (target, values) => {
    if (values.length % 2) throw new Error('DXF group codes and values must be paired.');
    for (let i = 0; i < values.length; i += 2) target.push([values[i], values[i + 1]]);
  };

  // Fixed handles for structures referenced before they are written.
  const h = {};
  for (const key of [
    'vportTable',
    'ltypeTable',
    'layerTable',
    'styleTable',
    'viewTable',
    'ucsTable',
    'appidTable',
    'dimstyleTable',
    'blockRecordTable',
    'modelRecord',
    'paperRecord',
    'modelBlock',
    'modelEnd',
    'paperBlock',
    'paperEnd',
    'rootDict',
    'groupDict',
    'layoutDict',
    'mlineDict',
    'plotStyleDict',
    'plotStyleNormal',
    'modelLayout',
    'paperLayout',
    'mlineStandard',
    'styleStandard',
  ])
    h[key] = handle();

  const put = (...values) => {
    for (let i = 0; i < values.length; i += 2) {
      const [code, value] = [values[i], values[i + 1]];
      if (code === 0) entities.push([0, value], [5, handle()], [330, h.modelRecord]);
      else entities.push([code, value]);
    }
  };

  function toString() {
    const out = [];
    const emit = (...values) => pairs(out, values);
    const table = (name, tableHandle, count, records, extra = []) => {
      emit(0, 'TABLE', 2, name, 5, tableHandle, 330, 0, 100, 'AcDbSymbolTable', 70, count, ...extra);
      records();
      emit(0, 'ENDTAB');
    };
    const record = (type, owner, subclass, ...values) =>
      emit(0, type, 5, handle(), 330, owner, 100, 'AcDbSymbolTableRecord', 100, subclass, ...values);

    const allLtypes = [
      { name: 'ByBlock', description: '', pattern: [] },
      { name: 'ByLayer', description: '', pattern: [] },
      { name: CONTINUOUS, description: 'Solid line', pattern: [] },
      ...ltypes,
    ];
    const allLayers = [{ name: '0', color: 7, ltype: CONTINUOUS }, ...layers.filter(layer => layer.name !== '0')];

    // Table and entity handles are allocated below; HANDSEED is written last.
    const body = [];
    const header = [];
    pairs(header, [
      0,
      'SECTION',
      2,
      'HEADER',
      9,
      '$ACADVER',
      1,
      'AC1024',
      9,
      '$DWGCODEPAGE',
      3,
      'ANSI_1252',
      9,
      '$INSBASE',
      10,
      0,
      20,
      0,
      30,
      0,
      9,
      '$INSUNITS',
      70,
      4,
      9,
      '$MEASUREMENT',
      70,
      1,
      9,
      '$LUNITS',
      70,
      2,
    ]);

    // TABLES
    emit(0, 'SECTION', 2, 'TABLES');
    table('VPORT', h.vportTable, 1, () =>
      record(
        'VPORT',
        h.vportTable,
        'AcDbViewportTableRecord',
        2,
        '*Active',
        70,
        0,
        10,
        0,
        20,
        0,
        11,
        1,
        21,
        1,
        12,
        0,
        22,
        0,
        13,
        0,
        23,
        0,
        14,
        0.5,
        24,
        0.5,
        15,
        0.5,
        25,
        0.5,
        16,
        0,
        26,
        0,
        36,
        1,
        17,
        0,
        27,
        0,
        37,
        0,
        40,
        1000,
        41,
        1.34,
        42,
        50,
        43,
        0,
        44,
        0,
        50,
        0,
        51,
        0,
        71,
        0,
        72,
        1000,
        73,
        1,
        74,
        3,
        75,
        0,
        76,
        0,
        77,
        0,
        78,
        0,
        281,
        0,
        65,
        0,
        146,
        0,
      ),
    );
    table('LTYPE', h.ltypeTable, allLtypes.length, () => {
      for (const ltype of allLtypes) {
        const length = ltype.pattern.reduce((sum, v) => sum + Math.abs(v), 0);
        record(
          'LTYPE',
          h.ltypeTable,
          'AcDbLinetypeTableRecord',
          2,
          ltype.name,
          70,
          0,
          3,
          ltype.description,
          72,
          65,
          73,
          ltype.pattern.length,
          40,
          length,
          ...ltype.pattern.flatMap(v => [49, v, 74, 0]),
        );
      }
    });
    table('LAYER', h.layerTable, allLayers.length, () => {
      for (const layer of allLayers)
        record(
          'LAYER',
          h.layerTable,
          'AcDbLayerTableRecord',
          2,
          layer.name,
          70,
          0,
          62,
          layer.color ?? 7,
          6,
          layer.ltype ?? CONTINUOUS,
          370,
          -3,
          390,
          h.plotStyleNormal,
        );
    });
    table('STYLE', h.styleTable, 1, () =>
      emit(
        0,
        'STYLE',
        5,
        h.styleStandard,
        330,
        h.styleTable,
        100,
        'AcDbSymbolTableRecord',
        100,
        'AcDbTextStyleTableRecord',
        2,
        'Standard',
        70,
        0,
        40,
        0,
        41,
        1,
        50,
        0,
        71,
        0,
        42,
        2.5,
        3,
        'txt',
        4,
        '',
      ),
    );
    table('VIEW', h.viewTable, 0, () => {});
    table('UCS', h.ucsTable, 0, () => {});
    table('APPID', h.appidTable, 1, () => record('APPID', h.appidTable, 'AcDbRegAppTableRecord', 2, 'ACAD', 70, 0));
    table(
      'DIMSTYLE',
      h.dimstyleTable,
      1,
      () =>
        emit(
          0,
          'DIMSTYLE',
          105,
          handle(),
          330,
          h.dimstyleTable,
          100,
          'AcDbSymbolTableRecord',
          100,
          'AcDbDimStyleTableRecord',
          2,
          'Standard',
          70,
          0,
          340,
          h.styleStandard,
        ),
      [100, 'AcDbDimStyleTable'],
    );
    table('BLOCK_RECORD', h.blockRecordTable, 2, () => {
      emit(
        0,
        'BLOCK_RECORD',
        5,
        h.modelRecord,
        330,
        h.blockRecordTable,
        100,
        'AcDbSymbolTableRecord',
        100,
        'AcDbBlockTableRecord',
        2,
        '*Model_Space',
        340,
        h.modelLayout,
        70,
        0,
        280,
        1,
        281,
        0,
      );
      emit(
        0,
        'BLOCK_RECORD',
        5,
        h.paperRecord,
        330,
        h.blockRecordTable,
        100,
        'AcDbSymbolTableRecord',
        100,
        'AcDbBlockTableRecord',
        2,
        '*Paper_Space',
        340,
        h.paperLayout,
        70,
        0,
        280,
        1,
        281,
        0,
      );
    });
    emit(0, 'ENDSEC');

    // BLOCKS
    emit(0, 'SECTION', 2, 'BLOCKS');
    for (const [begin, end, owner, name] of [
      [h.modelBlock, h.modelEnd, h.modelRecord, '*Model_Space'],
      [h.paperBlock, h.paperEnd, h.paperRecord, '*Paper_Space'],
    ]) {
      emit(
        0,
        'BLOCK',
        5,
        begin,
        330,
        owner,
        100,
        'AcDbEntity',
        8,
        '0',
        100,
        'AcDbBlockBegin',
        2,
        name,
        70,
        0,
        10,
        0,
        20,
        0,
        30,
        0,
        3,
        name,
        1,
        '',
      );
      emit(0, 'ENDBLK', 5, end, 330, owner, 100, 'AcDbEntity', 8, '0', 100, 'AcDbBlockEnd');
    }
    emit(0, 'ENDSEC');

    // ENTITIES
    emit(0, 'SECTION', 2, 'ENTITIES');
    out.push(...entities);
    emit(0, 'ENDSEC');

    // OBJECTS
    const layout = (layoutHandle, name, owner, flag, tab) =>
      emit(
        0,
        'LAYOUT',
        5,
        layoutHandle,
        330,
        h.layoutDict,
        100,
        'AcDbPlotSettings',
        1,
        '',
        4,
        'A3',
        6,
        '',
        40,
        7.5,
        41,
        20,
        42,
        7.5,
        43,
        20,
        44,
        420,
        45,
        297,
        46,
        0,
        47,
        0,
        48,
        0,
        49,
        0,
        140,
        0,
        141,
        0,
        142,
        1,
        143,
        1,
        70,
        flag,
        72,
        1,
        73,
        0,
        74,
        5,
        7,
        '',
        75,
        16,
        76,
        0,
        77,
        2,
        78,
        300,
        147,
        1,
        148,
        0,
        149,
        0,
        100,
        'AcDbLayout',
        1,
        name,
        70,
        1,
        71,
        tab,
        10,
        0,
        20,
        0,
        11,
        420,
        21,
        297,
        12,
        0,
        22,
        0,
        32,
        0,
        14,
        1e20,
        24,
        1e20,
        34,
        1e20,
        15,
        -1e20,
        25,
        -1e20,
        35,
        -1e20,
        146,
        0,
        13,
        0,
        23,
        0,
        33,
        0,
        16,
        1,
        26,
        0,
        36,
        0,
        17,
        0,
        27,
        1,
        37,
        0,
        76,
        1,
        330,
        owner,
      );
    emit(0, 'SECTION', 2, 'OBJECTS');
    emit(
      0,
      'DICTIONARY',
      5,
      h.rootDict,
      330,
      0,
      100,
      'AcDbDictionary',
      281,
      1,
      3,
      'ACAD_GROUP',
      350,
      h.groupDict,
      3,
      'ACAD_LAYOUT',
      350,
      h.layoutDict,
      3,
      'ACAD_MLINESTYLE',
      350,
      h.mlineDict,
      3,
      'ACAD_PLOTSTYLENAME',
      350,
      h.plotStyleDict,
    );
    emit(0, 'DICTIONARY', 5, h.groupDict, 330, h.rootDict, 100, 'AcDbDictionary', 281, 1);
    emit(
      0,
      'DICTIONARY',
      5,
      h.layoutDict,
      330,
      h.rootDict,
      100,
      'AcDbDictionary',
      281,
      1,
      3,
      'Model',
      350,
      h.modelLayout,
      3,
      'Layout1',
      350,
      h.paperLayout,
    );
    emit(
      0,
      'DICTIONARY',
      5,
      h.mlineDict,
      330,
      h.rootDict,
      100,
      'AcDbDictionary',
      281,
      1,
      3,
      'Standard',
      350,
      h.mlineStandard,
    );
    emit(
      0,
      'ACDBDICTIONARYWDFLT',
      5,
      h.plotStyleDict,
      330,
      h.rootDict,
      100,
      'AcDbDictionary',
      281,
      1,
      3,
      'Normal',
      350,
      h.plotStyleNormal,
      100,
      'AcDbDictionaryWithDefault',
      340,
      h.plotStyleNormal,
    );
    emit(0, 'ACDBPLACEHOLDER', 5, h.plotStyleNormal, 330, h.plotStyleDict);
    layout(h.modelLayout, 'Model', h.modelRecord, 1024, 0);
    layout(h.paperLayout, 'Layout1', h.paperRecord, 0, 1);
    emit(
      0,
      'MLINESTYLE',
      5,
      h.mlineStandard,
      330,
      h.mlineDict,
      100,
      'AcDbMlineStyle',
      2,
      'Standard',
      70,
      0,
      3,
      '',
      62,
      256,
      51,
      90,
      52,
      90,
      71,
      2,
      49,
      0.5,
      62,
      256,
      6,
      'BYLAYER',
      49,
      -0.5,
      62,
      256,
      6,
      'BYLAYER',
    );
    emit(0, 'ENDSEC', 0, 'EOF');

    pairs(header, [9, '$HANDSEED', 5, hex(next), 0, 'ENDSEC', 0, 'SECTION', 2, 'CLASSES', 0, 'ENDSEC']);
    body.push(...header, ...out);
    return body.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n';
  }

  return { put, toString };
}
