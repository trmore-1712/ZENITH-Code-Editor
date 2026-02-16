import os
import json
import logging
from typing import Dict, List, Any, Optional
import requests
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langchain_core.prompts import (
    ChatPromptTemplate,
    HumanMessagePromptTemplate,
    SystemMessagePromptTemplate,
)
import google.generativeai as genai

logger = logging.getLogger(__name__)

class GeminiService:
    def __init__(self):
        """Initialize Gemini service"""
        self.api_key = os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            logger.error("GEMINI_API_KEY is not set")
            # This allows the app to start, but calls will fail/log warnings
            logger.warning("Generative AI features will be unavailable.")
        
        if self.api_key:
            genai.configure(api_key=self.api_key)
            self.llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=self.api_key, temperature=0.7)
            self.model = "gemini-2.5-flash"
            logger.info(f"Gemini Service initialized with model: {self.model}")
            
            # Initialize specialized LLMs
            self.creative_llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=self.api_key, temperature=0.9)
            self.precise_llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=self.api_key, temperature=0.1)
            self.analytical_llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=self.api_key, temperature=0.3)
        else:
            self.llm = None
            self.creative_llm = None
            self.precise_llm = None
            self.analytical_llm = None
            self.model = "gemini-2.5-flash (unconfigured)"

    def _ensure_configured(self):
        if not self.llm:
            # Try to reload key in case it was added later
            self.api_key = os.getenv("GEMINI_API_KEY")
            if self.api_key:
                genai.configure(api_key=self.api_key)
                self.llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=self.api_key, temperature=0.7)
            else:
                raise ValueError("GEMINI_API_KEY is missing. Please add it to .env file.")

    def generate_documentation(self, code: str, context: str = "") -> Dict[str, Any]:
        """Generate comprehensive documentation for code"""
        try:
            self._ensure_configured()
            system_prompt = """You are an expert technical writer. Your task is to generate comprehensive documentation for the provided codebase/file.

            The user wants the documentation to be structured specifically with these sections:
            1. **Concepts**: Explain the core concepts, design patterns, and algorithmic principles used.
            2. **Description**: A detailed narrative description of what the code does, its purpose, and its functionality.
            3. **Structure**: An analysis of the code's structure, architecture, module organization, and how components interact.
            4. **Key Components**: A reference of important classes, functions, and their roles.
            
            IMPORTANT:
            - Format the output in clean Markdown.
            - Do NOT act as a chatbot. Do NOT say "Please provide code". 
            - If the code context is provided, USE IT. 
            - If the code seems incomplete, document what is there to the best of your ability.
            - The output will be converted to PDF, so use standard Markdown formatting.

            Context: {context}
            """
            
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=f"Generate documentation for this code:\n\n{code}"),
            ]
            
            response = self.llm.invoke(messages)
            
            return {
                "success": True,
                "documentation": response.content,
                "model": self.model
            }

        except Exception as e:
            logger.error(f"Error generating documentation: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "documentation": f"Error generating documentation: {str(e)}"
            }

    def explain_code(self, code: str, language: str = "auto", detail_level: str = "comprehensive") -> str:
        try:
            self._ensure_configured()
            if language == "auto":
                language = self._detect_language(code)
                
            system_prompt = f"""You are an expert code explainer. Explain the {language} code in {detail_level} detail.

Explanation should include:
1. What the code does
2. How it works (step by step)
3. Key algorithms and data structures
4. Time and space complexity analysis
5. Use cases and applications
6. Potential improvements

Make the explanation clear and accessible.
"""
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=f"Explain this {language} code:\n```{language}\n{code}\n```"),
            ]
            response = self.llm.invoke(messages)
            return response.content
        except Exception as e:
            logger.error(f"Error explaining code: {str(e)}")
            return f"Error explaining code: {str(e)}"

    def debug_code(self, code: str, language: str = "auto", error_message: str = "") -> Dict[str, Any]:
        try:
            self._ensure_configured()
            if language == "auto":
                language = self._detect_language(code)
                
            system_prompt = f"""You are an expert debugger for {language}. Find and fix issues in the code.

Instructions:
1. Analyze the code for syntax errors and bugs
2. Check for runtime issues and security vulnerabilities
3. Suggest specific fixes
4. Provide corrected code

Error message: {error_message}
"""
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=f"Debug this {language} code:\n```{language}\n{code}\n```"),
            ]
            response = self.llm.invoke(messages)
            content = response.content
            corrected_code = self._extract_code_blocks(content)
            
            return {
                "success": True,
                "debugged_code": corrected_code[0] if corrected_code else code,
                "explanation": content,
                "issues_found": self._extract_issues(content),
                "fixes_applied": ["Fixed issues using AI analysis"],
            }
        except Exception as e:
            logger.error(f"Error debugging code: {str(e)}")
            return {
                "success": False,
                "debugged_code": code,
                "explanation": f"Error: {str(e)}",
                "issues_found": [],
                "fixes_applied": [],
            }

    def optimize_code(self, code: str, language: str = "auto", optimization_type: str = "performance") -> Dict[str, Any]:
        try:
            self._ensure_configured()
            if language == "auto":
                language = self._detect_language(code)
                
            system_prompt = f"""You are an expert {language} optimizer. Optimize the code for {optimization_type}.

Provide both the optimized code and explanation of changes.
"""
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=f"Optimize this {language} code:\n```{language}\n{code}\n```"),
            ]
            response = self.llm.invoke(messages)
            content = response.content
            optimized_code = self._extract_code_blocks(content)
            
            return {
                "success": True,
                "optimized_code": optimized_code[0] if optimized_code else code,
                "explanation": content,
                "improvements": [f"Optimized for {optimization_type}"],
                "before_metrics": {"lines": len(code.split("\n"))},
                "after_metrics": {"lines": len(optimized_code[0].split("\n")) if optimized_code else len(code.split("\n"))},
            }
        except Exception as e:
            logger.error(f"Error optimizing code: {str(e)}")
            return {
                "success": False,
                "optimized_code": code,
                "explanation": f"Error: {str(e)}",
                "improvements": [],
                "before_metrics": {},
                "after_metrics": {},
            }

    def chat(self, message: str, history: List[Dict] = None, context: Dict = None) -> Dict[str, Any]:
        try:
            self._ensure_configured()
            messages = []
            system_content = """You are an AI coding assistant. You help by answering questions about the codebase.
Your goal is to explain concepts clearly in text.Be helpful, accurate.
DO NOT generate code blocks or implementation examples.
Focus on high-level explanations, logic, and architecture.
"""
            if context:
                # Special handling for RAG components
                file_tree = context.get("file_tree")
                rag_context = context.get("rag_context")
                
                if file_tree:
                    system_content += f"\nPROJECT STRUCTURE (Use this to understand file organization):\n{file_tree}\n"
                    
                if rag_context:
                    system_content += f"\nRETRIEVED CODE CONTEXT (Use this to understand implementation details):\n{rag_context}\n"
                
                # Add other context items
                other_context = {k:v for k,v in context.items() if k not in ["file_tree", "rag_context"]}
                if other_context:
                    system_content += f"\nADDITIONAL CONTEXT:\n{json.dumps(other_context, indent=2)}"
            
            messages.append(SystemMessage(content=system_content))
            
            if history:
                 for msg in history[-6:]:
                    if msg["role"] == "user":
                        messages.append(HumanMessage(content=msg["content"]))
                    elif msg["role"] == "assistant":
                        messages.append(AIMessage(content=msg["content"]))
            
            messages.append(HumanMessage(content=message))
            
            response = self.llm.invoke(messages)
            
            new_history = (history or []) + [
                {"role": "user", "content": message},
                {"role": "assistant", "content": response.content},
            ]
            
            return {
                "success": True,
                "response": response.content,
                "history": new_history[-10:],
                "model": self.model,
            }
        except Exception as e:
            logger.error(f"Chat error: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "response": f"Error: {str(e)}",
                "history": history or [],
            }

    def reframe_query(self, message: str, history: List[Dict] = None) -> str:
        """Reframe user query into a precise search query based on history"""
        try:
            self._ensure_configured()
            
            system_prompt = """You are an expert search query generator for a code RAG system.
Your task is to rewrite the user's latest message into a precise, standalone search query.

Guidelines:
1. Use conversation history to resolve pronouns (it, that, the file).
2. If the user mentions specific filenames (e.g., app.py), INCLUDE them in the query.
3. If the user asks "how does it work", focus on "implementation details", "logic", or "flow".
4. If the message is already clear (e.g., "Search for login"), return it as is.
5. Return ONLY the search query.

Examples:
- History: [User: Show me app.py] -> User: "How does it handle errors?"
  Output: error handling implementation in app.py

- History: [User: What is RAG?] -> User: "Where is the code for that?"
  Output: RAG implementation code location

- User: "Explain the main.js file"
  Output: main.js file explanation code logic
"""
            
            messages = [SystemMessage(content=system_prompt)]
            
            if history:
                # meaningful_history = history[-4:] # Keep it short
                for msg in history[-4:]:
                    role = "User" if msg["role"] == "user" else "AI"
                    messages.append(HumanMessage(content=f"{role}: {msg['content']}"))
            
            messages.append(HumanMessage(content=f"User: {message}\nOutput Search Query:"))
            
            response = self.llm.invoke(messages)
            reframed = response.content.strip()
            logger.info(f"Reframed query: '{message}' -> '{reframed}'")
            return reframed
            
        except Exception as e:
            logger.error(f"Error reframing query: {str(e)}")
            return message # Fallback to original message

    def write_tests(self, code: str, language: str = "auto", test_framework: str = "") -> Dict[str, Any]:
        try:
            self._ensure_configured()
            if language == "auto":
                language = self._detect_language(code)
            
            system_prompt = f"""You are an expert in writing tests for {language}."""
            if test_framework:
                system_prompt += f" Use {test_framework}."
                
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=f"Write tests for this {language} code:\n```{language}\n{code}\n```"),
            ]
            response = self.llm.invoke(messages)
            content = response.content
            tests = self._extract_code_blocks(content)
            
            return {
                "success": True,
                "tests": tests[0] if tests else "",
                "test_explanation": content,
                "coverage": 80.0,
                "test_cases": ["Generated tests"],
            }
        except Exception as e:
            logger.error(f"Error writing tests: {str(e)}")
            return {"success": False, "tests": "", "test_explanation": f"Error: {str(e)}", "coverage": 0.0, "test_cases": []}

    def analyze_code(self, code: str, language: str = "auto", analysis_type: str = "comprehensive") -> Dict[str, Any]:
        try:
            self._ensure_configured()
            if language == "auto":
                language = self._detect_language(code)
                
            system_prompt = f"You are an expert code analyst. Perform {analysis_type} analysis of this {language} code."
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=f"Analyze this {language} code:\n```{language}\n{code}\n```"),
            ]
            response = self.llm.invoke(messages)
            content = response.content
            
            return {
                "success": True,
                "analysis": content,
                "complexity": {"cyclomatic": "Unknown", "cognitive": "Unknown"},
                "quality_score": 80.0,
                "issues": self._extract_issues(content),
                "recommendations": ["See analysis"],
            }
        except Exception as e:
            logger.error(f"Error analyzing code: {str(e)}")
            return {"success": False, "analysis": f"Error: {str(e)}", "complexity": {}, "quality_score": 0.0, "issues": [], "recommendations": []}

    def convert_code(self, code: str, source_language: str, target_language: str) -> Dict[str, Any]:
        try:
            self._ensure_configured()
            if source_language == "auto":
                source_language = self._detect_language(code)
                
            system_prompt = f"You are an expert code converter. Convert code from {source_language} to {target_language}."
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=f"Convert this {source_language} code to {target_language}:\n```{source_language}\n{code}\n```"),
            ]
            response = self.llm.invoke(messages)
            content = response.content
            converted_code = self._extract_code_blocks(content)
            
            return {
                "success": True,
                "converted_code": converted_code[0] if converted_code else "",
                "explanation": content,
                "compatibility_notes": [],
            }
        except Exception as e:
            logger.error(f"Error converting code: {str(e)}")
            return {"success": False, "converted_code": "", "explanation": f"Error: {str(e)}", "compatibility_notes": []}

    def document_code(self, code: str, language: str = "auto", documentation_style: str = "comprehensive") -> Dict[str, Any]:
        try:
            self._ensure_configured()
            if language == "auto":
                language = self._detect_language(code)
                
            system_prompt = f"You are an expert technical writer. Add {documentation_style} documentation to this {language} code."
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=f"Add documentation to this {language} code:\n```{language}\n{code}\n```"),
            ]
            response = self.llm.invoke(messages)
            content = response.content
            documented_code = self._extract_code_blocks(content)
            
            return {
                "success": True,
                "documented_code": documented_code[0] if documented_code else code,
                "documentation": content,
                "summary": f"Added {documentation_style} documentation",
            }
        except Exception as e:
            logger.error(f"Error documenting code: {str(e)}")
            return {"success": False, "documented_code": code, "documentation": f"Error: {str(e)}", "summary": ""}

    def generate_visualization(self, code: str, language: str = "auto") -> Dict[str, Any]:
        """Generate a self-contained HTML/JS visualization for the given algorithm"""
        try:
            self._ensure_configured()
            if language == "auto":
                language = self._detect_language(code)
            
            system_prompt = """You are an expert Algorithm Visualizer and Creative Technologist. 
            Your task is to generate a single, self-contained HTML file (with embedded CSS and JS) that provides a HIGHLY DYNAMIC and INTERACTIVE visualization of the provided algorithm.
            
            Visual Aesthetics:
            - Use a premium, dark-mode "Cyberpunk" or "VS Code Dark" theme.
            - Colors: Primary #007acc (blue), Secondary #4ec9b0 (teal), Highlight #ffbd2e (orange).
            - Use smooth CSS transitions and subtle glow effects.
            
            Real-time & Movement:
            - Use `requestAnimationFrame` for smooth animations and transitions.
            - Visualization MUST be fluid (e.g., bars sliding, nodes pulsing, pointers moving smoothly).
            - If visualizing data (like an array), animate the changes (swaps, updates) using a timeline/state approach.
            
            Dynamic User Input & Controls:
            - Provide a sophisticated Control Panel at the bottom.
            - Include a [Data Input] field where users can provide custom data (e.g., "5, 2, 8, 1, 9").
            - Include a [Generate] button to update the visualization with the custom data instantly.
            - Include [Play/Pause], [Step Forward], [Step Back], and [Reset] buttons.
            - Include a [Speed Slider] to control animation velocity in real-time.
            - The visualization MUST react to these inputs immediately without reloading.
            
            Implementation Details:
            - Implement the core algorithm in JavaScript.
            - Capture "snapshots" of the algorithm's state at each step.
            - Provide a clear [Step Explanation] area that updates as the algorithm progresses.
            - Use Vanilla JS, HTML5 Canvas, or D3.js (via CDN: https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js).
            - Ensure the code is robust and handles invalid user input gracefully.
            
            Structure:
            - Header: Title and Algorithm Type.
            - Sidebar/Top: Step explanation and current state variables.
            - Main: Large, centered animation area.
            - Footer: Fixed control panel with inputs and playback controls.
            """
            
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=f"Create a visualization for this {language} algorithm:\n```{language}\n{code}\n```"),
            ]
            
            response = self.llm.invoke(messages)
            content = response.content
            
            # Extract HTML block
            import re
            html_matches = re.findall(r"```html\n(.*?)\n```", content, re.DOTALL)
            visualization_html = html_matches[0].strip() if html_matches else content
            
            return {
                "success": True,
                "visualization": visualization_html,
                "model": self.model
            }
        except Exception as e:
            logger.error(f"Error generating visualization: {str(e)}")
            return {
                "success": False, 
                "error": str(e), 
                "visualization": f"<h1>Error generating visualization</h1><p>{str(e)}</p>"
            }

    def _detect_language(self, code: str) -> str:
        code_lower = code.lower()
        language_patterns = {
            "python": ["def ", "import ", "from ", "print(", "class "],
            "javascript": ["function ", "const ", "let ", "var ", "console.log", "=>"],
            "java": ["public class", "public static", "System.out.println", "import java"],
            "cpp": ["#include", "using namespace", "cout <<", "std::"],
            "html": ["<!DOCTYPE", "<html", "<head", "<body", "<div"],
            "css": ["{", "}", ":", ";", ".class", "#id"],
            "sql": ["SELECT", "FROM", "WHERE", "INSERT", "UPDATE"],
        }
        for lang, patterns in language_patterns.items():
            if any(pattern in code_lower for pattern in patterns):
                return lang
        return "python"

    def _extract_code_blocks(self, text: str) -> List[str]:
        import re
        pattern = r"```(?:\w+)?\n(.*?)\n```"
        matches = re.findall(pattern, text, re.DOTALL)
        return [match.strip() for match in matches]

    def _extract_issues(self, text: str) -> List[str]:
        issues = []
        lines = text.split("\n")
        for line in lines:
            if any(keyword in line.lower() for keyword in ["error", "bug", "issue", "problem", "warning", "vulnerability"]):
                issues.append(line.strip())
        return issues[:5]

    def _get_default_test_framework(self, language: str) -> str:
        frameworks = {
            "python": "pytest",
            "javascript": "jest",
            "java": "junit",
            "cpp": "gtest",
            "csharp": "nunit",
            "go": "testing",
            "rust": "cargo test",
        }
        return frameworks.get(language, "unit testing")
