from typing import Dict, List, Any, TypedDict, Annotated
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langchain_core.messages import HumanMessage, SystemMessage
import logging

logger = logging.getLogger(__name__)

class EditState(TypedDict):
    """State for Multi-File Edit Workflow"""
    messages: Annotated[List[Any], add_messages]
    task: str
    files: List[str]  # List of relevant files
    plan: str
    edits: List[Dict[str, str]] # List of {file_path, new_content, original_content, diff}
    analysis: str

class MultiFileEditWorkflow:
    """Orchestrates multi-file edits with AST analysis and planning"""

    def __init__(self, llm_service, rag_service=None, tree_sitter_service=None):
        self.llm_service = llm_service
        self.rag_service = rag_service
        self.tree_sitter_service = tree_sitter_service
        self.workflow = self._create_workflow()

    def _create_workflow(self):
        workflow = StateGraph(EditState)

        workflow.add_node("analyze_context", self._analyze_context)
        workflow.add_node("plan_changes", self._plan_changes)
        workflow.add_node("generate_content", self._generate_content)

        workflow.set_entry_point("analyze_context")
        workflow.add_edge("analyze_context", "plan_changes")
        workflow.add_edge("plan_changes", "generate_content")
        workflow.add_edge("generate_content", END)

        return workflow.compile()

    def _analyze_context(self, state: EditState) -> EditState:
        """Analyze files using RAG for discovery and AST/Regex for structure"""
        logger.info("Analyzing context for multi-file edit")
        
        # 1. RAG Discovery (Hybrid Strategy)
        discovered_files = set(state.get("files", []))
        rag_context = ""
        
        if self.rag_service:
            try:
                # Infer relevant files from the task even if not explicitly mentioned
                logger.info(f"Querying RAG for task: {state['task']}")
                search_result = self.rag_service.query_with_context(state['task'])
                rag_context = search_result.get("context", "")
                
                # Extract filenames from RAG content (File: ...) logic or sources
                for source in search_result.get("sources", []):
                    # Only add if it's a file in the project (rag sources are usually relative paths or filenames)
                    if source and source != "unknown":
                         # Heuristic: if it looks like a file path, add it
                         # Sources from rag_service are usually filenames
                         import os
                         if os.path.exists(source) or (self.rag_service.current_indexed_path and os.path.exists(os.path.join(self.rag_service.current_indexed_path, source))):
                             if self.rag_service.current_indexed_path and not os.path.isabs(source):
                                 full_path = os.path.join(self.rag_service.current_indexed_path, source)
                                 discovered_files.add(full_path)
                             else:
                                 discovered_files.add(source)
                                 
                logger.info(f"RAG discovered files: {discovered_files}")
                
            except Exception as e:
                logger.error(f"RAG discovery failed: {e}")

        # Update state with discovered files so subsequent steps see them
        state["files"] = list(discovered_files)

        # 2. Structure Analysis (AST/Content/Tree-sitter)
        analysis_results = []
        if rag_context:
            analysis_results.append("--- RAG Context (Relevant Snippets) ---")
            analysis_results.append(rag_context + "\n")

        import os
        
        for file_path in state.get("files", []):
            if not os.path.exists(file_path):
                continue
                
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                analysis_results.append(f"--- File: {os.path.basename(file_path)} ---")
                
                # Use Tree-sitter if available
                if self.tree_sitter_service:
                    structure = self.tree_sitter_service.parse_file(file_path, content)
                    if "error" in structure:
                         analysis_results.append(f"Structure: (Error: {structure['error']})")
                    else:
                         analysis_results.append(f"Structure: Language={structure.get('language')}")
                         analysis_results.append(f"Classes={structure.get('classes', [])}")
                         analysis_results.append(f"Functions={structure.get('functions', [])}")
                else:
                    # Fallback (Simple read) or old AST logic if desired, but we are replacing it.
                    analysis_results.append("Structure: (Tree-sitter not available)")
                    
            except Exception as e:
                logger.error(f"Error analyzing file {file_path}: {e}")
        
        state["analysis"] = "\n".join(analysis_results)
        return state

    def _plan_changes(self, state: EditState) -> EditState:
        """Plan which files to edit and how"""
        logger.info("Planning changes")
        
        prompt = f"""
        Plan the following coding task across multiple files.
        You can MODIFY existing files or CREATE NEW files if needed.
        
        Task: {state['task']}
        Analysis of provided files:
        {state['analysis']}
        
        Files currently available: {state['files']}
        
        Provide a plan that:
        1. Identifies which files need modification.
        2. Identifies any NEW files to be created.
        3. Describes the specific changes/content for each file.
        4. Ensures consistency across files.
        """
        
        messages = [
            SystemMessage(content="You are a senior software architect planning a multi-file refactor."),
            HumanMessage(content=prompt)
        ]
        
        response = self.llm_service.creative_llm.invoke(messages)
        state["messages"].append(response)
        state["plan"] = response.content
        return state

    def _generate_content(self, state: EditState) -> EditState:
        """Generate the new content for each file"""
        logger.info("Generating content")
        
        plan = state["plan"]
        edits = []
        
        # Ask LLM for a structured list of files to edit/create based on the plan
        candidates_prompt = f"""
        Based on this plan, list ALL files that need to be created or modified. 
        Return strictly a valid JSON list of strings.
        Example: ["app.py", "utils.py", "new_service.py"]
        
        Plan:
        {plan}
        
        Existing files: {state['files']}
        """
        
        candidates_msg = [
             SystemMessage(content="You are a helper. Return strictly a JSON list of strings. Do not use markdown blocks."),
             HumanMessage(content=candidates_prompt)
        ]
        
        try:
             import json
             import re
             import ast
             
             resp = self.llm_service.precise_llm.invoke(candidates_msg)
             content = resp.content.strip()
             
             # Robust Parsing Strategy
             target_files = []
             match = re.search(r"\[.*\]", content, re.DOTALL)
             if match:
                 try:
                     target_files = json.loads(match.group(0))
                 except:
                     try: target_files = ast.literal_eval(match.group(0))
                     except: pass
             
             if not target_files:
                  if "," in content: target_files = [f.strip().strip('"') for f in content.split(",")]
                  else: target_files = state['files']
                  
             if not isinstance(target_files, list): target_files = state['files']
                  
        except Exception as e:
             logger.error(f"Failed to parse target files: {e}")
             target_files = state['files']

        import os
        
        for file_path in target_files:
             # Check if file exists to decide prompt nuance
             file_exists = os.path.exists(file_path)
             original_content = ""
             
             if file_exists:
                 with open(file_path, "r", encoding="utf-8") as f:
                     original_content = f.read()
                 
                 # TOKEN SAVER: Use SEARCH/REPLACE for existing files
                 prompt = f"""
                 Based on the plan, apply changes to: {file_path}
                 
                 Plan: {plan}
                 
                 Use SEARCH/REPLACE blocks to modify the code.
                 Format:
                 <<<<<<< SEARCH
                 [exact code to replace]
                 =======
                 [new code]
                 >>>>>>> REPLACE
                 
                 Rules:
                 1. SEARCH block must exactly match existing code (include indentation).
                 2. Include multiple blocks if needed.
                 3. Do NOT rewrite the whole file.
                 
                 Original File Content:
                 ```
                 {original_content}
                 ```
                 """
                 
                 prompt_type = "PATCH"
             else:
                 prompt = f"""
                 Create new file: {file_path}
                 Plan: {plan}
                 Output the FULL content of the new file.
                 """
                 prompt_type = "CREATE"
             
             messages = [
                SystemMessage(content="You are an expert coder. Output clean code or patch blocks."),
                HumanMessage(content=prompt)
             ]
             
             response = self.llm_service.precise_llm.invoke(messages)
             generated_text = response.content
             

            
             if prompt_type == "PATCH":
                 # Extract hunks manually without applying them
                 # Parse blocks: <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE
                 import re
                 pattern = r"<{7}\s*SEARCH\s*\n(.*?)\n={7}\s*\n(.*?)\n>{7}\s*REPLACE"
                 matches = list(re.finditer(pattern, generated_text, re.DOTALL))
                 
                 hunks = []
                 for match in matches:
                     hunks.append({
                         "search": match.group(1),
                         "replace": match.group(2)
                     })
                 
                 # Optimization: Don't calculate diff here, just send hunks.
                 edits.append({
                    "file_path": file_path,
                    "hunks": hunks,
                    "is_new": False
                 })
                 
             else:
                 # New file
                 new_content = generated_text
                 match = re.search(r"```(?:\w+)?\n(.*?)\n```", new_content, re.DOTALL)
                 if match: new_content = match.group(1)
            
                 edits.append({
                    "file_path": file_path,
                    "new_content": new_content,
                    "hunks": [], # No hunks for new file
                    "is_new": True
                 })
        
        state["edits"] = edits
        return state

    def run(self, task: str, files: List[str]) -> Dict[str, Any]:
        """Run the multi-file edit workflow"""
        try:
            logger.info(f"Starting multi-file edit for: {task[:50]}...")
            
            initial_state = EditState(
                messages=[],
                task=task,
                files=files,
                plan="",
                edits=[],
                analysis=""
            )
            
            final_state = self.workflow.invoke(initial_state)
            
            return {
                "success": True,
                "analysis": final_state.get("analysis", ""),
                "plan": final_state.get("plan", ""),
                "edits": final_state.get("edits", []),
                "summary": f"Generated {len(final_state.get('edits', []))} edits"
            }
            
        except Exception as e:
            logger.error(f"Multi-file workflow error: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return {
                "success": False,
                "error": str(e),
                "edits": []
            }
