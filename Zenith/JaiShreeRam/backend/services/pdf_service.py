import os
import io
import re
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT

class PDFService:
    def __init__(self):
        self.styles = getSampleStyleSheet()
        self.styleN = self.styles['Normal']
        self.styleH = self.styles['Heading1']
        self.styleH2 = self.styles['Heading2']
        self.styleH3 = self.styles['Heading3']
        self.styleCode = ParagraphStyle(
            'Code',
            parent=self.styles['Code'],
            fontSize=9,
            leading=11,
            fontName='Courier',
            backColor='#f5f5f5',
            borderPadding=5
        )
        self.styleList = ParagraphStyle(
            'ListBullet',
            parent=self.styles['Normal'],
            leftIndent=15,
            firstLineIndent=0,
            spaceAfter=5
        )

    def _markdown_to_xml(self, text):
        # Escape XML characters first
        text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        
        # Bold **text** -> <b>text</b>
        text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
        
        # Italic *text* -> <i>text</i>
        text = re.sub(r'\*(.*?)\*', r'<i>\1</i>', text)
        
        # Code `text` -> <font name="Courier">text</font>
        text = re.sub(r'`(.*?)`', r'<font name="Courier" backColor="#f0f0f0">\1</font>', text)
        
        return text

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
            
            lines = content.split('\n')
            in_code_block = False
            code_block_content = []
            
            for line in lines:
                line = line.strip()
                
                # Code Blocks
                if line.startswith('```'):
                    if in_code_block:
                        # End of code block
                        full_code = '<br/>'.join(code_block_content)
                        story.append(Paragraph(full_code, self.styleCode))
                        story.append(Spacer(1, 10))
                        code_block_content = []
                        in_code_block = False
                    else:
                        in_code_block = True
                    continue
                
                if in_code_block:
                    code_block_content.append(line.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))
                    continue
                
                if not line:
                    story.append(Spacer(1, 10))
                    continue
                
                # Headings
                if line.startswith('# '):
                    story.append(Paragraph(self._markdown_to_xml(line[2:]), self.styleH))
                    story.append(Spacer(1, 12))
                elif line.startswith('## '):
                    story.append(Paragraph(self._markdown_to_xml(line[3:]), self.styleH2))
                    story.append(Spacer(1, 10))
                elif line.startswith('### '):
                    story.append(Paragraph(self._markdown_to_xml(line[4:]), self.styleH3))
                    story.append(Spacer(1, 10))
                # Lists
                elif line.startswith('- ') or line.startswith('* '):
                    xml_text = self._markdown_to_xml(line[2:])
                    # Use a bullet character
                    story.append(Paragraph(f'&bull; {xml_text}', self.styleList))
                else:
                    # Normal text
                    story.append(Paragraph(self._markdown_to_xml(line), self.styleN))
            
            doc.build(story)
            return file_path
            
        except Exception as e:
            print(f"Error creating PDF: {str(e)}")
            raise e

