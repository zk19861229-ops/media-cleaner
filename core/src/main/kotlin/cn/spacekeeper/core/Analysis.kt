package cn.spacekeeper.core

import java.util.UUID
import kotlin.math.abs

object Grouping {
    fun exact(assets: List<Asset>): List<MediaGroup> = assets
        .filter { it.hash?.matches(Regex("[a-f0-9]{64}")) == true && it.size > 0 }
        .groupBy { "${it.size}:${it.hash}" }.values.filter { it.size > 1 }
        .map { group(Relation.EXACT_DUPLICATE, it.sortedBy { asset -> asset.id }, "sha256-full-v1", "文件大小及完整 SHA-256 一致") }

    // Every member is compared directly with the anchor; similarity is not transitive.
    fun similar(assets: List<Asset>, exactGroups: List<MediaGroup>): List<MediaGroup> {
        val duplicateExtras = exactGroups.flatMap { it.members.drop(1) }.map { it.id }.toSet()
        val candidates = assets.filter {
            it.isImage && it.perceptualHash != null && !it.hash.isNullOrBlank() &&
                it.width >= 64 && it.height >= 64 && it.id !in duplicateExtras
        }.sortedWith(compareByDescending<Asset> { it.sharpness }.thenBy { it.id })
        val tree = HashTree()
        val anchors = mutableListOf<MutableList<Asset>>()
        for (asset in candidates) {
            val match = tree.near(asset.perceptualHash!!, 6).asSequence().map { anchors[it] }
                .filter { members ->
                    val anchor = members.first()
                    anchor.hash != asset.hash &&
                        abs(anchor.width.toDouble() / anchor.height - asset.width.toDouble() / asset.height) < 0.04
                }.minByOrNull { java.lang.Long.bitCount(it.first().perceptualHash!! xor asset.perceptualHash) }
            if (match == null) {
                tree.add(asset.perceptualHash, anchors.size)
                anchors += mutableListOf(asset)
            } else match += asset
        }
        return anchors.filter { it.size > 1 }.map {
            group(Relation.VISUALLY_SIMILAR, it, "dhash64-anchor-hamming6-v1", "缩略图视觉相似；可能包含不同文字、动作或细节，需逐项查看")
        }
    }

    private fun group(relation: Relation, members: List<Asset>, algorithm: String, description: String): MediaGroup {
        val id = sha256((relation.name + members.map { it.id }.sorted().joinToString()).toByteArray()).take(24)
        return MediaGroup(id, relation, members, Evidence("e_$id", relation, members.map { it.id }, algorithm, description))
    }
}

private class HashTree {
    private data class Node(val hash: Long, val indices: MutableList<Int>, val children: MutableMap<Int, Node> = mutableMapOf())
    private var root: Node? = null
    fun add(hash: Long, index: Int) {
        var node = root ?: run { root = Node(hash, mutableListOf(index)); return }
        while (true) {
            val distance = java.lang.Long.bitCount(node.hash xor hash)
            if (distance == 0) { node.indices += index; return }
            val next = node.children[distance]
            if (next == null) { node.children[distance] = Node(hash, mutableListOf(index)); return }
            node = next
        }
    }
    fun near(hash: Long, radius: Int): List<Int> {
        val result = mutableListOf<Int>()
        val pending = ArrayDeque<Node>()
        root?.let { pending.add(it) }
        while (pending.isNotEmpty()) {
            val node = pending.removeLast()
            val distance = java.lang.Long.bitCount(node.hash xor hash)
            if (distance <= radius) result += node.indices
            node.children.filterKeys { it in (distance - radius)..(distance + radius) }.values.forEach { pending.add(it) }
        }
        return result
    }
}

object LocalDecisionProvider {
    fun recommend(group: MediaGroup): Recommendation = Recommendation(
        DecisionType.RECOMMEND_KEEPER,
        group.members.maxWithOrNull(compareBy<Asset> { it.sharpness }.thenBy { it.width.toLong() * it.height })?.id,
        reason = ReasonCode.SHARPER_IMAGE,
    )
}

object PlanCompiler {
    fun compile(
        scopeId: String, assets: List<Asset>, policy: Policy,
        recommendations: Map<String, Recommendation> = emptyMap(), now: Long = System.currentTimeMillis(),
    ): Plan {
        require(assets.all { it.scopeId == scopeId }) { "文件不在同一授权范围" }
        require(assets.map { it.id }.distinct().size == assets.size) { "文件标识重复" }
        require(assets.map { it.uri }.distinct().size == assets.size) { "文件地址重复" }
        val planId = UUID.randomUUID().toString()
        val exact = Grouping.exact(assets)
        // Exact-duplicate groups are wholly excluded from similarity actions to prevent keeper chains.
        val exactIds = exact.flatMap { it.members }.map { it.id }.toSet()
        val similar = if (policy.includeSimilar) Grouping.similar(assets.filter { it.id !in exactIds }, emptyList()) else emptyList()
        val groups = exact + similar
        val actions = groups.flatMap { group ->
            val response = recommendations[group.id]
            val recommendation = response?.takeIf { validRecommendation(group, it) }
                ?: Recommendation(DecisionType.REQUEST_REVIEW)
            val keeper = if (group.relation == Relation.EXACT_DUPLICATE) {
                group.members.sortedWith(compareByDescending<Asset> { it.isProtected(policy) }.thenBy { it.id }).first()
            } else {
                if (recommendation.decision == DecisionType.KEEP_ALL) return@flatMap emptyList()
                group.members.find { it.id == recommendation.keeperAssetId } ?: group.members.first()
            }
            group.members.filter { it.id != keeper.id && !it.isProtected(policy) }.map { target ->
                PlannedAction(
                    "${planId}_${group.id}_${target.id}", group.id, group.relation, target.snapshot(), keeper.snapshot(), group.evidence.id,
                    selected = group.relation == Relation.EXACT_DUPLICATE,
                    confidence = if (response != null && validRecommendation(group, response)) response.confidence else null,
                    decisionSource = if (group.relation == Relation.EXACT_DUPLICATE) "sha256" else recommendation.source,
                )
            }
        }
        return Plan(planId, scopeId = scopeId, createdAt = now, actions = actions, groups = groups, policy = policy)
            .also { require(ManifestRules.validate(it).isEmpty()) { "生成的计划未通过约束检查" } }
    }

    fun validRecommendation(group: MediaGroup, response: Recommendation): Boolean {
        if (response.confidence != null && (!response.confidence.isFinite() || response.confidence !in 0.0..1.0)) return false
        return when (response.decision) {
            DecisionType.RECOMMEND_KEEPER -> group.members.any { it.id == response.keeperAssetId }
            else -> response.keeperAssetId == null
        }
    }
}
