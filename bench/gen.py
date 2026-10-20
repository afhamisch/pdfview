import sys, io, random
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
out=sys.argv[1]; kind=sys.argv[2]; n=int(sys.argv[3])
c=canvas.Canvas(out,pagesize=letter)
random.seed(1)
words="the court finds that plaintiff has established by competent substantial evidence that defendant breached the agreement and damages follow accordingly".split()
if kind=='text':
    for i in range(n):
        c.setFont("Helvetica-Bold",14); c.drawString(72,740,f"IN THE CIRCUIT COURT, PAGE {i+1} OF {n}")
        c.setFont("Helvetica",10.5)
        y=715
        for ln in range(48):
            c.drawString(72,y," ".join(random.choice(words) for _ in range(14)))
            y-=13.5
        c.line(72,60,540,60); c.drawString(72,45,f"Page {i+1}")
        c.showPage()
else:
    from PIL import Image
    import numpy as np
    for i in range(n):
        arr=(np.random.rand(2200,1700)*40+200).astype('uint8')
        arr[::40,:]=30; arr[:, ::60]=30
        im=Image.fromarray(arr,'L'); b=io.BytesIO(); im.save(b,'JPEG',quality=70); b.seek(0)
        from reportlab.lib.utils import ImageReader
        c.drawImage(ImageReader(b),0,0,width=612,height=792)
        c.showPage()
c.save()
print(out)
