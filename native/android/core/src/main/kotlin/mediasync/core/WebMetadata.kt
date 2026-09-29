package mediasync.core

/** Title and icon of a companion page, parsed from the first bytes of its HTML. */
data class WebMetadata(val title: String?, val iconUrl: String?) {
    companion object {
        const val MAX_HTML_CHARS = 200 * 1024
        private val meta = Regex("<meta[^>]*>", RegexOption.IGNORE_CASE)
        private val link = Regex("<link[^>]*>", RegexOption.IGNORE_CASE)
        private val title = Regex("<title[^>]*>([\\s\\S]*?)</title>", RegexOption.IGNORE_CASE)

        fun parse(html: String, pageUrl: String): WebMetadata {
            val head = html.take(MAX_HTML_CHARS)
            val metas = meta.findAll(head).map { it.value }.toList()
            fun metaContent(name: String) = metas.firstOrNull {
                (attribute(it, "property") ?: attribute(it, "name"))?.equals(name, ignoreCase = true) == true
            }?.let { attribute(it, "content") }
            val pageTitle = metaContent("og:title")?.let(::decode)?.ifEmpty { null }
                ?: title.find(head)?.groupValues?.get(1)?.replace(Regex("\\s+"), " ")?.let(::decode)?.ifEmpty { null }
            val icons = link.findAll(head).map { it.value }.mapNotNull { tag ->
                val rel = attribute(tag, "rel")?.lowercase() ?: return@mapNotNull null
                val href = attribute(tag, "href") ?: return@mapNotNull null
                if ("icon" in rel) rel to href else null
            }.toList()
            val icon = icons.firstOrNull { "apple-touch-icon" in it.first }?.second
                ?: metaContent("og:image")
                ?: icons.firstOrNull()?.second
                ?: "/favicon.ico"
            return WebMetadata(pageTitle?.take(200), MpdParser.resolve(pageUrl, icon))
        }

        private fun attribute(tag: String, name: String): String? {
            val match = Regex("$name\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", RegexOption.IGNORE_CASE).find(tag) ?: return null
            return match.groupValues.drop(2).firstOrNull { it.isNotEmpty() }
        }

        private fun decode(text: String): String = text
            .replace(Regex("&#(\\d{1,6});")) { runCatching { String(Character.toChars(it.groupValues[1].toInt())) }.getOrDefault("") }
            .replace("&lt;", "<", ignoreCase = true).replace("&gt;", ">", ignoreCase = true)
            .replace("&quot;", "\"", ignoreCase = true).replace("&#39;", "'").replace("&apos;", "'", ignoreCase = true)
            .replace("&nbsp;", " ", ignoreCase = true).replace("&amp;", "&", ignoreCase = true)
            .trim()
    }
}
