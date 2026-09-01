import Foundation

/// One second of link measurements derived from libsrt's CBytePerfMon deltas.
struct LinkSample {
    /// (retransmitted + too-late-dropped) / packets sent during the interval, 0..1.
    let lossRatio: Double
    /// Smoothed RTT in ms.
    let rttMs: Double
    /// Sender buffer occupancy in ms (how far the encoder is running ahead of the link).
    let sendBufferMs: Double
    /// Negotiated SRT latency in ms (the buffer we are allowed to use).
    let latencyMs: Double
    /// libsrt bandwidth estimate in kbps (0 when unknown).
    let bandwidthKbps: Double
    /// Current encoder target in kbps.
    let currentKbps: Int
}

enum BitrateDecision: Equatable {
    case hold
    case stepDown(kbps: Int, reason: String)
    case stepUp(kbps: Int)
}

/// Contribution-side adaptive bitrate for a single SRT link.
///
/// Design (mirrors what SRT-capable field encoders do, tuned for a phone on cellular):
///  * React FAST to congestion: one bad second (loss/retransmission, send buffer
///    filling past half the latency window, RTT blow-up) steps the video bitrate
///    down 25 %, with a short cooldown so consecutive bad seconds ramp down quickly.
///  * Recover SLOWLY: only after `upAfterGoodSamples` consecutive clean seconds,
///    in 15 % steps, never above the ceiling and never above ~70 % of libsrt's
///    bandwidth estimate when it has one.
///  * Thermal pressure caps the ceiling (serious → 60 %, critical → 35 %) so the
///    device does not throttle the encoder mid-stream.
/// Pure and deterministic: no timers, no I/O — easy to reason about and to test.
struct AdaptiveBitrateController {
    var minKbps: Int
    var maxKbps: Int
    /// Effective ceiling after thermal capping.
    private(set) var ceilingKbps: Int
    var upAfterGoodSamples = 8
    var downCooldownSamples = 3
    private var goodStreak = 0
    private var cooldown = 0
    private(set) var lastCongestion: Double = 0

    init(minKbps: Int, maxKbps: Int) {
        self.minKbps = max(100, minKbps)
        self.maxKbps = max(self.minKbps, maxKbps)
        self.ceilingKbps = self.maxKbps
    }

    mutating func setThermal(_ state: ProcessInfo.ThermalState) {
        let factor: Double
        switch state {
        case .critical: factor = 0.35
        case .serious: factor = 0.6
        default: factor = 1.0
        }
        ceilingKbps = max(minKbps, Int(Double(maxKbps) * factor))
    }

    mutating func setMax(_ kbps: Int) {
        maxKbps = max(minKbps, kbps)
        ceilingKbps = min(ceilingKbps, maxKbps)
        if ceilingKbps < minKbps { ceilingKbps = minKbps }
    }

    /// 0..1 congestion estimate. Weighted: loss dominates, then buffer growth, then RTT.
    static func congestion(of s: LinkSample) -> Double {
        let loss = min(1.0, s.lossRatio / 0.05)                      // 5 % loss = saturated
        let halfLatency = max(1.0, s.latencyMs / 2.0)
        let buffer = min(1.0, max(0.0, s.sendBufferMs - halfLatency) / halfLatency)
        let rtt = min(1.0, max(0.0, s.rttMs - 200.0) / 300.0)       // >500 ms RTT = saturated
        return min(1.0, 0.55 * loss + 0.30 * buffer + 0.15 * rtt)
    }

    mutating func evaluate(_ s: LinkSample) -> BitrateDecision {
        let c = Self.congestion(of: s)
        lastCongestion = c
        if cooldown > 0 { cooldown -= 1 }

        // Hard ceiling (thermal / user) always wins.
        if s.currentKbps > ceilingKbps {
            goodStreak = 0
            return .stepDown(kbps: ceilingKbps, reason: "ceiling")
        }

        if c >= 0.6 {
            goodStreak = 0
            if cooldown == 0 {
                cooldown = downCooldownSamples
                let target = max(minKbps, Int(Double(s.currentKbps) * 0.75))
                if target < s.currentKbps {
                    return .stepDown(kbps: target, reason: s.lossRatio > 0.02 ? "loss" : (s.sendBufferMs > s.latencyMs / 2 ? "buffer" : "rtt"))
                }
            }
            return .hold
        }

        if c < 0.15 {
            goodStreak += 1
            if goodStreak >= upAfterGoodSamples && s.currentKbps < ceilingKbps {
                goodStreak = 0
                var target = min(ceilingKbps, Int(Double(s.currentKbps) * 1.15) + 1)
                if s.bandwidthKbps > 0 {
                    target = min(target, max(minKbps, Int(s.bandwidthKbps * 0.7)))
                }
                if target > s.currentKbps { return .stepUp(kbps: target) }
            }
            return .hold
        }

        // Mild congestion: neither ramp nor cut, but reset the good streak.
        goodStreak = 0
        return .hold
    }
}

/// Exponential backoff with ±20 % jitter (same shape the web viewer uses: 1 s · 1.5ⁿ, capped at 30 s).
enum Backoff {
    static func delay(attempt: Int, base: Double = 1.0, multiplier: Double = 1.5, cap: Double = 30.0) -> TimeInterval {
        let raw = min(cap, base * pow(multiplier, Double(max(0, attempt - 1))))
        let jitter = 0.8 + Double.random(in: 0...0.4)
        return raw * jitter
    }
}
