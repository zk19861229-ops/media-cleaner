import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import com.android.manifmerger.ManifestMerger2;
import com.android.manifmerger.MergingReport;
import com.android.utils.StdLogger;

/** Use the SDK's actual manifest merger for the standalone debug build. */
public final class MergeManifest {
    public static void main(String[] args) throws Exception {
        var invoker = ManifestMerger2.newMerger(new File(args[0]),
            new StdLogger(StdLogger.Level.WARNING), ManifestMerger2.MergeType.APPLICATION)
            .setPlaceHolderValue("applicationId", "cn.spacekeeper.app");
        for (int i = 2; i < args.length; i++) invoker.addLibraryManifest(new File(args[i]));
        var report = invoker.merge();
        if (report.getResult().isError()) throw new IllegalStateException(report.getReportString());
        Files.writeString(Path.of(args[1]), report.getMergedDocument(MergingReport.MergedManifestKind.MERGED));
    }
}
