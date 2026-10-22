package cn.spacekeeper.app

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/** Only ship the fourteen icons we use, rather than the full extended icon font/library. */
object AppIcons {
    private fun icon(name: String, data: String) = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString(data).toNodes(), fill = null, stroke = SolidColor(Color.Black),
            strokeLineWidth = 1.8f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round)
    }.build()
    val PieChart = icon("空间", "M10 3 A9 9 0 1 0 21 14 H10 Z M14 3 V10 H21 A9 9 0 0 0 14 3 Z")
    val Checklist = icon("清单", "M9 6 H21 M9 12 H21 M9 18 H21 M3 5 L4 6 L6 3 M3 11 L4 12 L6 9 M3 17 L4 18 L6 15")
    val History = icon("记录", "M3 11 A9 9 0 1 1 5 18 M3 4 V11 H10 M12 7 V12 L15 14")
    val Tune = icon("设置", "M3 6 H7 M11 6 H21 M3 12 H13 M17 12 H21 M3 18 H5 M9 18 H21 M7 3 H11 V9 H7 Z M13 9 H17 V15 H13 Z M5 15 H9 V21 H5 Z")
    val AutoAwesome = icon("智能整理", "M12 3 L14.5 9.5 L21 12 L14.5 14.5 L12 21 L9.5 14.5 L3 12 L9.5 9.5 Z M20 2 V6 M18 4 H22")
    val FolderOpen = icon("文件夹", "M3 7 V5 H9 L11 7 H21 V10 M3 7 V20 H19 L22 10 H7 L3 20")
    val Search = icon("分析", "M18 10 A7 7 0 1 1 4 10 A7 7 0 1 1 18 10 M16 16 L21 21")
    val Shield = icon("保护", "M12 3 L4 6 V12 C4 17 8 20 12 22 C16 20 20 17 20 12 V6 Z")
    val VerifiedUser = icon("确认保护", "M12 3 L4 6 V12 C4 17 8 20 12 22 C16 20 20 17 20 12 V6 Z M8 12 L11 15 L16 9")
    val DeleteOutline = icon("删除", "M3 6 H21 M9 6 V3 H15 V6 M5 6 L6 21 H18 L19 6 M10 10 V17 M14 10 V17")
    val ContentCopy = icon("重复", "M8 8 H21 V21 H8 Z M16 4 V2 H2 V16 H4")
    val BurstMode = icon("相似照片", "M7 4 H22 V20 H7 Z M4 6 V18 M1 8 V16 M9 17 L13 12 L16 15 L18 13 L21 17 M17 8 H18")
    val CheckCircle = icon("保留", "M21 12 A9 9 0 1 1 3 12 A9 9 0 1 1 21 12 M7 12 L10 15 L17 8")
    val Info = icon("说明", "M21 12 A9 9 0 1 1 3 12 A9 9 0 1 1 21 12 M12 11 V17 M12 7 V7.1")
}
