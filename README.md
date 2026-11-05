# pa-solder-copper-auto-draw

5G RRU PA（功率放大器）焊料 / Copper Coin 自動出圖工具。

輸入 PA 封裝與設計參數（YAML），自動計算並輸出：

| 圖層 | 說明 |
|---|---|
| `PA_BODY` | PA 本體外框 |
| `PA_PAD` | Exposed pad / flange |
| `SOLDER` | 焊料區（支援 window-pane 鋼板開窗分割，降低 void） |
| `COPPER_COIN` | Copper coin 外形（pad 外擴 + 圓角） |
| `PCB_CUTOUT` | PCB 挖槽（coin + 間隙） |
| `DIM` | 基本尺寸標註 |

輸出格式：**DXF**（CAD 用，各層分開）＋ **PNG** 預覽圖，並列出焊料覆蓋率。

## 安裝

```bash
pip install -e ".[dev]"
```

## 使用

```bash
pa-draw examples/pa_example.yaml -o output
```

輸出範例：

```
[PA_example]
  pad          : 8.00 x 4.00 mm
  solder       : 6 windows, area 25.20 mm², coverage 78.8%
  copper coin  : 9.00 x 5.00 mm (R0.3)
  PCB cutout   : 9.20 x 5.20 mm
  -> output/PA_example.dxf
  -> output/PA_example.png
```

## 專案結構

```
src/pa_draw/
  models.py      資料模型（Rect、PAPackage、SolderSpec、CopperCoinSpec）
  config.py      讀取 YAML
  geometry.py    幾何計算（內縮、外擴、開窗分割）
  dxf_writer.py  DXF 輸出（ezdxf）
  preview.py     PNG 預覽（matplotlib）
  cli.py         命令列入口
examples/        範例參數
tests/           pytest 測試
output/          輸出資料夾（不進版控）
```

## 測試

```bash
pytest
```

## Roadmap

- [ ] 從 Excel / CSV 批次讀入多顆 PA
- [ ] 多 PA 同板排版
- [ ] 焊料 / coin 一維熱阻估算（Rth = t / (k·A)）
- [ ] STEP 輸出（給 Icepak / FloTHERM 建模）
- [ ] 非矩形 pad（多 lead、flange 開孔）
