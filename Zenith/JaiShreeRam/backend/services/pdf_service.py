import os
import io
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT

class PDFService:
    def __init__(self):
        self.styles = getSampleStyleSheet()
        self.styleN = self.styles['Normal']
        self.styleH = self.styles['Heading1']
        self.styleH2 = self.styles['Heading2']
        self.styleCode = ParagraphStyle(
            'Code',
            parent=self.styles['Code'],
            fontSize=8,
            leading=10,
            fontName='Courier'
        )

    def create_pdf(self, content: str, filename: str) -> str:
        """
        Creates a PDF file from the given content string.
        Returns the absolute path to the generated PDF.
        """
        try:
            # Ensure output directory exists (e.g., 'generated_docs')
            output_dir = os.path.join(os.getcwd(), 'generated_docs')
            if not os.path.exists(output_dir):
                os.makedirs(output_dir)
            
            file_path = os.path.join(output_dir, filename)
            
            doc = SimpleDocTemplate(
                file_path,
                pagesize=letter,
                rightMargin=72,
                leftMargin=72,
                topMargin=72,
                bottomMargin=18
            )
            
            story = []
            
            # Simple Markdown-ish parser
            lines = content.split('\n')
            
            for line in lines:
                line = line.strip()
                if not line:
                    story.append(Spacer(1, 12))
                    continue
                
                if line.startswith('# '):
                    story.append(Paragraph(line[2:], self.styleH))
                    story.append(Spacer(1, 12))
                elif line.startswith('## '):
                    story.append(Paragraph(line[3:], self.styleH2))
                    story.append(Spacer(1, 12))
                elif line.startswith('```'):
                    # Skip code block markers for now or handle them
                    continue
                else:
                    # Handle basic formatting if needed, ReportLab supports some XML tags
                    # For now just plain text
                    # Escape XML characters? ReportLab Paragraph does XML
                    safe_line = line.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                    story.append(Paragraph(safe_line, self.styleN))
            
            doc.build(story)
            return file_path
            
        except Exception as e:
            print(f"Error creating PDF: {str(e)}")
            raise e
