import AVFoundation
import MobileVLCKit
import SwiftUI

final class ProbePlayer: ObservableObject {
    let player = VLCMediaPlayer(options: ["--verbose=2"])
    @Published var samples = ""
    private var timer: Timer?
    private var startedAt = ProcessInfo.processInfo.systemUptime

    func play(_ address: String) {
        guard let url = URL(string: address), ["http", "https"].contains(url.scheme) else { return }
        stop()
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            samples = "Audio session: \(error.localizedDescription)"
            return
        }
        startedAt = ProcessInfo.processInfo.systemUptime
        samples = "elapsed,mediaSeconds,rate,state,seekable\n"
        player.media = VLCMedia(url: url)
        player.play()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            self?.sample()
        }
    }

    func setRate(_ rate: Float) {
        player.rate = rate
        record("rate-request,\(rate)")
    }

    func seek(_ seconds: Int32) {
        guard player.isSeekable else { record("seek-rejected,not-seekable"); return }
        record("seek-request,\(seconds)")
        player.time = VLCTime(int: seconds * 1000)
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        player.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func sample() {
        let elapsed = ProcessInfo.processInfo.systemUptime - startedAt
        record("\(elapsed),\(Double(player.time.intValue) / 1000),\(player.rate),\(player.state.rawValue),\(player.isSeekable)")
    }

    private func record(_ line: String) {
        NSLog("DASH_PROBE %@", line)
        samples += line + "\n"
        if samples.count > 16000 { samples = String(samples.suffix(12000)) }
    }
}

struct ProbeSurface: UIViewRepresentable {
    let player: VLCMediaPlayer

    func makeUIView(context: Context) -> UIView {
        let surface = UIView()
        surface.backgroundColor = .black
        player.drawable = surface
        return surface
    }

    func updateUIView(_ view: UIView, context: Context) {}
}

@main
struct DashProbeApp: App {
    @StateObject private var owner = ProbePlayer()
    @State private var address = ""
    @State private var rate: Float = 1
    @State private var seekSeconds = 10

    var body: some Scene {
        WindowGroup {
            VStack {
                TextField("MPD URL", text: $address)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .keyboardType(.URL)
                ProbeSurface(player: owner.player).aspectRatio(16 / 9, contentMode: .fit)
                HStack {
                    Button { owner.play(address) } label: { Image(systemName: "play.fill") }
                        .accessibilityLabel("Play")
                    Button { owner.stop() } label: { Image(systemName: "stop.fill") }
                        .accessibilityLabel("Stop")
                    Picker("Rate", selection: $rate) {
                        ForEach([Float(0.95), 0.998, 1, 1.002, 1.05], id: \.self) { value in
                            Text(String(format: "%.3f", value)).tag(value)
                        }
                    }.onChange(of: rate) { owner.setRate($0) }
                }
                HStack {
                    Stepper("\(seekSeconds) s", value: $seekSeconds, in: 0...3600, step: 5)
                    Button { owner.seek(Int32(seekSeconds)) } label: { Image(systemName: "forward.end.fill") }
                        .accessibilityLabel("Seek")
                }
                ScrollView {
                    Text(owner.samples).font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
            }.padding().onDisappear { owner.stop() }
        }
    }
}