package cn.spacekeeper.app

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import cn.spacekeeper.core.*
import kotlinx.serialization.encodeToString

class AppDatabase(context: Context) : SQLiteOpenHelper(context, "ontology.db", null, 1), ExecutionLedger {
    override fun onConfigure(db: SQLiteDatabase) { db.setForeignKeyConstraintsEnabled(true) }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE objects (kind TEXT NOT NULL, id TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL, PRIMARY KEY(kind,id))")
        db.execSQL("CREATE INDEX object_scope ON objects(kind,scope)")
        db.execSQL("CREATE TABLE relations (subject TEXT NOT NULL, predicate TEXT NOT NULL, object_id TEXT NOT NULL, PRIMARY KEY(subject,predicate,object_id))")
        db.execSQL("CREATE TABLE journal (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        db.execSQL("CREATE TABLE protections (id TEXT PRIMARY KEY)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    fun save(kind: String, id: String, payload: String, scope: String = "") {
        writableDatabase.insertWithOnConflict("objects", null, ContentValues().apply {
            put("kind", kind); put("id", id); put("scope", scope); put("payload", payload)
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }
    fun read(kind: String, id: String): String? = readableDatabase.rawQuery(
        "SELECT payload FROM objects WHERE kind=? AND id=?", arrayOf(kind, id),
    ).use { if (it.moveToFirst()) it.getString(0) else null }
    fun list(kind: String, scope: String? = null): List<String> = readableDatabase.rawQuery(
        "SELECT payload FROM objects WHERE kind=?" + if (scope == null) "" else " AND scope=?",
        if (scope == null) arrayOf(kind) else arrayOf(kind, scope),
    ).use { cursor -> buildList { while (cursor.moveToNext()) add(cursor.getString(0)) } }
    fun remove(kind: String, id: String) { writableDatabase.delete("objects", "kind=? AND id=?", arrayOf(kind, id)) }
    fun relation(subject: String, predicate: String, objectId: String) {
        writableDatabase.insertWithOnConflict("relations", null, ContentValues().apply {
            put("subject", subject); put("predicate", predicate); put("object_id", objectId)
        }, SQLiteDatabase.CONFLICT_IGNORE)
    }
    fun saveAsset(asset: Asset) {
        save("asset", asset.id, codec.encodeToString(asset), asset.scopeId)
        relation(asset.id, "belongs_to", asset.scopeId)
    }
    fun assets(scope: String) = list("asset", scope).map { codec.decodeFromString<Asset>(it).let { a -> a.copy(protected = isProtected(a.id)) } }
    fun visibleAssets(scope: String): List<Asset> {
        val inventory = read("inventory", scope)?.let { codec.decodeFromString<List<String>>(it).toSet() } ?: return emptyList()
        return assets(scope).filter { it.id in inventory }
    }
    fun savePlan(plan: Plan) = transaction {
        save("plan", plan.id, codec.encodeToString(plan), plan.scopeId)
        plan.groups.forEach { group ->
            save("group", "${plan.id}:${group.id}", codec.encodeToString(group), plan.scopeId)
            save("evidence", "${plan.id}:${group.evidence.id}", codec.encodeToString(group.evidence), plan.scopeId)
            group.members.forEach { relation(it.id, "member_of", "${plan.id}:${group.id}") }
        }
        plan.actions.forEach {
            relation("${plan.id}:${it.id}", "targets", it.target.assetId)
            relation("${plan.id}:${it.id}", "retains", it.keeper.assetId)
        }
    }
    fun plans() = list("plan").map { codec.decodeFromString<Plan>(it) }.sortedByDescending { it.createdAt }
    fun plan(id: String) = read("plan", id)?.let { codec.decodeFromString<Plan>(it) }
    fun approval(planId: String) = read("approval", planId)?.let { codec.decodeFromString<Approval>(it) }
    fun approve(plan: Plan, approval: Approval) = transaction {
        require(approval.matches(plan))
        require(ManifestRules.validate(plan).isEmpty())
        save("approval", plan.id, codec.encodeToString(approval))
        savePlan(plan.copy(status = PlanStatus.APPROVED))
    }
    override fun get(actionId: String): ActionResult? = readableDatabase.rawQuery("SELECT payload FROM journal WHERE id=?", arrayOf(actionId))
        .use { if (it.moveToFirst()) codec.decodeFromString<ActionResult>(it.getString(0)) else null }
    override fun put(result: ActionResult) {
        writableDatabase.insertWithOnConflict("journal", null, ContentValues().apply {
            put("id", result.actionId); put("payload", codec.encodeToString(result))
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }
    fun protect(id: String, enabled: Boolean) {
        if (enabled) writableDatabase.insertWithOnConflict("protections", null, ContentValues().apply { put("id", id) }, SQLiteDatabase.CONFLICT_IGNORE)
        else writableDatabase.delete("protections", "id=?", arrayOf(id))
    }
    fun isProtected(id: String) = readableDatabase.rawQuery("SELECT 1 FROM protections WHERE id=?", arrayOf(id)).use { it.moveToFirst() }
    fun <T> transaction(block: () -> T): T {
        writableDatabase.beginTransaction()
        try { return block().also { writableDatabase.setTransactionSuccessful() } }
        finally { writableDatabase.endTransaction() }
    }
}
