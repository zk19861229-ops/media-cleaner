package cn.spacekeeper.app

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.decode.VideoFrameDecoder

class SpaceKeeperApplication : Application(), ImageLoaderFactory {
    override fun newImageLoader(): ImageLoader = ImageLoader.Builder(this)
        .components { add(VideoFrameDecoder.Factory()) }
        .respectCacheHeaders(false)
        .diskCache(null) // Media previews stay in memory; no extra persistent image copies.
        .build()
}
