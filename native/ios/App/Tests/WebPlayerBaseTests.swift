import XCTest
@testable import MediaSync

/// The DASH web player page must share the MPD's scheme: WebKit blocks plain-HTTP fetches from an HTTPS page.
final class WebPlayerBaseTests: XCTestCase {
    private let secure = "https://cdn.example/sync_webplayer/index.html"
    private let plain = "http://cdn.example/sync_webplayer/index.html"

    func testPlainHttpManifestUsesPlainPage() {
        XCTAssertEqual(SessionModel.webPlayerBase(mpdUrl: "http://tv.example/live.mpd", secure: secure, plain: plain), plain)
        XCTAssertEqual(SessionModel.webPlayerBase(mpdUrl: "HTTP://tv.example/live.mpd", secure: secure, plain: plain), plain)
    }

    func testHttpsManifestKeepsSecurePage() {
        XCTAssertEqual(SessionModel.webPlayerBase(mpdUrl: "https://tv.example/live.mpd", secure: secure, plain: plain), secure)
    }

    func testMissingVariantFallsBackToTheOther() {
        XCTAssertEqual(SessionModel.webPlayerBase(mpdUrl: "http://tv.example/live.mpd", secure: secure, plain: nil), secure)
        XCTAssertEqual(SessionModel.webPlayerBase(mpdUrl: "https://tv.example/live.mpd", secure: nil, plain: plain), plain)
        XCTAssertNil(SessionModel.webPlayerBase(mpdUrl: "http://tv.example/live.mpd", secure: nil, plain: nil))
    }

    func testBrandPlainPageIsPlainHttp() {
        if let plain = BrandConfig.syncWebPlayerHttpUrl {
            XCTAssertTrue(plain.hasPrefix("http://"))
        }
    }
}
