import XCTest
@testable import MediaSync

final class LocalizationTests: XCTestCase {
    func testTestBundleHasIndependentProductIdentity() throws {
        let testBundle = Bundle(for: LocalizationTests.self)
        XCTAssertEqual(testBundle.object(forInfoDictionaryKey: "CFBundleExecutable") as? String, "MediaSyncTests")
        XCTAssertNotEqual(try XCTUnwrap(testBundle.bundleIdentifier), try XCTUnwrap(Bundle.main.bundleIdentifier))
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "CFBundleExecutable") as? String, "MediaSync")
    }

    func testGeneratedStringsResolveInEveryLanguage() throws {
        XCTAssertNotEqual(L10n.t("discovery.title"), "discovery.title")
        XCTAssertEqual(L10n.list("help.troubleshootingSteps").count, 3)
        for language in BrandConfig.languages {
            let path = try XCTUnwrap(Bundle.main.path(forResource: language, ofType: "lproj"), language)
            let bundle = try XCTUnwrap(Bundle(path: path))
            let value = bundle.localizedString(forKey: "native.a11y.terminal", value: nil, table: nil)
            XCTAssertTrue(value.contains("%1$@") && value.contains("%2$@"), "\(language): \(value)")
        }
    }
}
