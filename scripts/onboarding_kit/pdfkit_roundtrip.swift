// PDFKit（Macのプレビューと同じ部品）で入力欄に値を入れて保存し、開き直して値と見え方を確かめる。
// 使い方: swift scripts/onboarding_kit/pdfkit_roundtrip.swift 入力.pdf 値.json 保存先.pdf 画像.png
//   値.json は {"欄の名前": "入れる文字列", ...}。載っていない欄は空のまま。
// 出力: 欄ごとに「一致/不一致」を表示し、保存後のPDFの1ページ目を PDFKit で描いた PNG を書き出す。
import AppKit
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count == 5 else {
    FileHandle.standardError.write("usage: swift pdfkit_roundtrip.swift in.pdf values.json out.pdf out.png\n".data(using: .utf8)!)
    exit(2)
}
let inURL = URL(fileURLWithPath: args[1])
let values = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[2]))) as! [String: String]
let outURL = URL(fileURLWithPath: args[3])
let pngURL = URL(fileURLWithPath: args[4])

guard let doc = PDFDocument(url: inURL) else { print("開けない: \(inURL.path)"); exit(1) }
var filled = 0
for i in 0..<doc.pageCount {
    for a in doc.page(at: i)!.annotations where a.widgetFieldType == .text {
        if let name = a.fieldName, let v = values[name] {
            a.widgetStringValue = v
            filled += 1
        }
    }
}
guard doc.write(to: outURL) else { print("保存に失敗"); exit(1) }

guard let re = PDFDocument(url: outURL) else { print("保存後に開けない"); exit(1) }
var ok = 0, ng = 0
for i in 0..<re.pageCount {
    for a in re.page(at: i)!.annotations where a.widgetFieldType == .text {
        guard let name = a.fieldName, let expected = values[name] else { continue }
        let got = a.widgetStringValue ?? ""
        if got == expected { ok += 1 } else { ng += 1; print("不一致: \(name) 期待=\(expected) 実際=\(got)") }
    }
}
print("入力 \(filled) 欄 / 再表示で一致 \(ok) / 不一致 \(ng) / ページ数 \(re.pageCount)")

// 1ページ目を 2倍で描画（注釈＝入力欄の外観を含む）
let page = re.page(at: 0)!
let box = page.bounds(for: .mediaBox)
let scale: CGFloat = 2
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(box.width * scale), pixelsHigh: Int(box.height * scale),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = ctx
let cg = ctx.cgContext
cg.setFillColor(NSColor.white.cgColor)
cg.fill(CGRect(x: 0, y: 0, width: box.width * scale, height: box.height * scale))
cg.scaleBy(x: scale, y: scale)
page.draw(with: .mediaBox, to: cg)
NSGraphicsContext.restoreGraphicsState()
try rep.representation(using: .png, properties: [:])!.write(to: pngURL)
exit(ng == 0 ? 0 : 1)
