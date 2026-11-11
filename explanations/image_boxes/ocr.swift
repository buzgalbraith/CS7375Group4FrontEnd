import Foundation
import Vision
import AppKit

// Usage: swift ocr.swift <image> → JSON: { width, height, lines: [{ text, box, chars: [{ c, box: [x,y,w,h] }] }] }
// Boxes are normalized 0–1 with the origin at the TOP-left.
let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fatalError("cannot read \(path)") }
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["ko-KR"]
req.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg).perform([req])
func box(_ r: CGRect) -> [Double] { [Double(r.minX), Double(1 - r.maxY), Double(r.width), Double(r.height)].map { (($0 * 10000.0).rounded()) / 10000.0 } }
var lines: [[String: Any]] = []
for obs in req.results ?? [] {
  guard let cand = obs.topCandidates(1).first else { continue }
  let s = cand.string
  var chars: [[String: Any]] = []
  var i = s.startIndex
  while i < s.endIndex {
    let next = s.index(after: i)
    let ch = String(s[i..<next])
    if !ch.trimmingCharacters(in: .whitespaces).isEmpty, let b = try? cand.boundingBox(for: i..<next) {
      chars.append(["c": ch, "box": box(b.boundingBox)])
    }
    i = next
  }
  lines.append(["text": s, "box": box(obs.boundingBox), "chars": chars])
}
let out: [String: Any] = ["width": cg.width, "height": cg.height, "lines": lines]
print(String(data: try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]), encoding: .utf8)!)
