package app.kumquant.healthbridge.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [SampleEntity::class, SessionEntity::class, PendingUpload::class, RawFileEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class HealthDatabase : RoomDatabase() {
    abstract fun sync(): SyncDao
    abstract fun queries(): HealthQueries

    companion object {
        @Volatile private var instance: HealthDatabase? = null

        fun get(context: Context): HealthDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, HealthDatabase::class.java, "health.db")
                .build()
                .also { instance = it }
        }
    }
}
