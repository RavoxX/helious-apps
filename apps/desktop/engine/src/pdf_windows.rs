use crate::vault::Result;
pub fn render(bytes: &[u8], index: u32) -> Result<serde_json::Value> {
    use windows::{
        Data::Pdf::{PdfDocument, PdfPageRenderOptions},
        Storage::Streams::{DataReader, DataWriter, InMemoryRandomAccessStream},
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    };
    if bytes.len() > 20 * 1024 * 1024 || !bytes.starts_with(b"%PDF-") {
        return Err("Invalid or oversized PDF.".into());
    }
    let initialized = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    if let Err(error) = &initialized {
        if error.code().0 as u32 != 0x80010106 {
            return Err("Windows PDF services are unavailable.".into());
        }
    }
    struct Apartment(bool);
    impl Drop for Apartment {
        fn drop(&mut self) {
            if self.0 {
                unsafe { RoUninitialize() }
            }
        }
    }
    let _apartment = Apartment(initialized.is_ok());
    let result=(||->windows::core::Result<_>{
        let input=InMemoryRandomAccessStream::new()?;let writer=DataWriter::CreateDataWriter(&input)?;writer.WriteBytes(bytes)?;writer.StoreAsync()?.join()?;writer.DetachStream()?;input.Seek(0)?;
        let pdf=PdfDocument::LoadFromStreamAsync(&input)?.join()?;let pages=pdf.PageCount()?;
        if pages>500||index>=pages{return Err(windows::core::Error::new(windows::core::HRESULT(0x80070057u32 as i32),"PDF page limit"));}
        let page=pdf.GetPage(index)?;let size=page.Size()?;
        if !size.Width.is_finite()||!size.Height.is_finite()||size.Width<=0.0||size.Height<=0.0{return Err(windows::core::Error::from_hresult(windows::core::HRESULT(0x80070057u32 as i32)));}
        let scale=(1400.0f32/size.Width).min(1600.0/size.Height).min(1.5);let options=PdfPageRenderOptions::new()?;options.SetDestinationWidth((size.Width*scale).ceil()as u32)?;options.SetDestinationHeight((size.Height*scale).ceil()as u32)?;
        let output=InMemoryRandomAccessStream::new()?;page.RenderWithOptionsToStreamAsync(&output,&options)?.join()?;let length=output.Size()?;
        if length>16_000_000{return Err(windows::core::Error::from_hresult(windows::core::HRESULT(0x80070057u32 as i32)));}
        let reader=DataReader::CreateDataReader(&output.GetInputStreamAt(0)?)?;reader.LoadAsync(length as u32)?.join()?;let mut data=vec![0;length as usize];reader.ReadBytes(&mut data)?;page.Close()?;Ok((data,pages))
    })().map_err(|_|"Cannot preview this PDF. Use an unencrypted PDF of at most 500 pages, or download the original.".to_string())?;
    let mut value = crate::reading::png_reply(result.0);
    value["pages"] = serde_json::json!(result.1);
    value["page"] = serde_json::json!(index);
    Ok(value)
}

#[cfg(test)]
mod tests {
    #[test]
    fn renders_a_native_pdf_page_without_a_browser() {
        let content = "BT /F1 18 Tf 40 100 Td (Helious) Tj ET";
        let objects=["<< /Type /Catalog /Pages 2 0 R >>".to_string(),"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".into(),"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into(),format!("<< /Length {} >>\nstream\n{content}\nendstream",content.len())];
        let mut source = "%PDF-1.4\n".to_string();
        let mut offsets = vec![];
        for (i, object) in objects.iter().enumerate() {
            offsets.push(source.len());
            source += &format!("{} 0 obj\n{object}\nendobj\n", i + 1);
        }
        let xref = source.len();
        source += "xref\n0 6\n0000000000 65535 f \n";
        for offset in offsets {
            source += &format!("{offset:010} 00000 n \n");
        }
        source += &format!("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");
        let result = super::render(source.as_bytes(), 0).unwrap();
        assert_eq!(result["pages"], 1);
        assert!(super::render(source.as_bytes(), 1).is_err());
    }
}
