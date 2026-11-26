import java.io.*;
import com.android.tools.smali.dexlib2.Opcodes;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedDexFile;
import com.android.tools.smali.baksmali.*;
public class DexDisassemble {
 public static void main(String[] a) throws Exception {
  try(InputStream in=new BufferedInputStream(new FileInputStream(a[0]))) {
   if(!Baksmali.disassembleDexFile(DexBackedDexFile.fromInputStream(Opcodes.getDefault(),in),new File(a[1]),2,new BaksmaliOptions())) throw new IOException("Disassembly failed");
  }
 }
}
