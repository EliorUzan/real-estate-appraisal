from importlib import import_module
from types import SimpleNamespace
import pytest
from pypdf import PdfWriter
from appraisal_assistant.domain.models import Attachment, SectionRequest
from appraisal_assistant.services.file_text_extractor import FileTextExtractor

PROVIDERS = ['qwen', 'moonshot', 'anthropic', 'openai', 'gemini']

def agent_for(provider):
    title = {'qwen':'Qwen','moonshot':'Moonshot','anthropic':'Anthropic','openai':'OpenAI','gemini':'Gemini'}[provider]
    settings = getattr(import_module(f'appraisal_assistant.infrastructure.{provider}_settings'), title+'Settings')(api_key='synthetic',model='synthetic')
    calls=[]
    def create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(output_text='synthetic',choices=[SimpleNamespace(message=SimpleNamespace(content='synthetic'))],content=[SimpleNamespace(text='synthetic')])
    endpoint=SimpleNamespace(create=create)
    client=SimpleNamespace(responses=endpoint,interactions=endpoint,messages=endpoint,chat=SimpleNamespace(completions=endpoint))
    cls=getattr(import_module(f'appraisal_assistant.agents.{provider}_environment_agent'),title+'EnvironmentDescriptionAgent')
    return cls(settings,client_factory=lambda **kwargs:client), calls

def request(paths):
    return SectionRequest(section_id='environment_description',address='synthetic',example='synthetic',example_attachments=tuple(Attachment(p,p.name,p.suffix) for p in paths))

@pytest.mark.parametrize('provider',PROVIDERS)
@pytest.mark.parametrize('failure',['missing','oversized','unreadable','empty'])
def test_required_failure_never_calls_provider(provider,failure,tmp_path,monkeypatch):
    valid=tmp_path/'valid.txt'; valid.write_text('שלום עולם',encoding='utf-8')
    bad=tmp_path/'bad.txt'
    if failure=='oversized':
        with bad.open('wb') as stream: stream.truncate(20*1024*1024+1)
    elif failure=='empty': bad.write_bytes(b'')
    elif failure=='unreadable': bad.mkdir()
    agent,calls=agent_for(provider)
    with pytest.raises(ValueError): agent.run(request([valid,bad]))
    assert calls==[]

@pytest.mark.parametrize('provider',['qwen','moonshot','anthropic'])
@pytest.mark.parametrize('text',['',' \n\t'])
def test_textless_conversion_never_calls_provider(provider,text,tmp_path,monkeypatch):
    path=tmp_path/'fixture.docx';path.write_bytes(b'synthetic')
    monkeypatch.setattr(FileTextExtractor,'extract_text',lambda *args:text)
    agent,calls=agent_for(provider)
    with pytest.raises(ValueError): agent.run(request([path]))
    assert calls==[]

@pytest.mark.parametrize('provider',['qwen','moonshot'])
def test_pdf_without_text_is_rejected_on_text_path(provider,tmp_path):
    path=tmp_path/'no-text.pdf';writer=PdfWriter();writer.add_blank_page(width=100,height=100);writer.write(path)
    agent,calls=agent_for(provider)
    with pytest.raises(ValueError): agent.run(request([path]))
    assert calls==[]

@pytest.mark.parametrize('provider',['openai','gemini','anthropic'])
def test_raw_pdf_kept_without_local_text_extraction(provider,tmp_path,monkeypatch):
    path=tmp_path/'no-text.pdf';writer=PdfWriter();writer.add_blank_page(width=100,height=100);writer.write(path)
    def forbidden(*args): raise AssertionError('raw PDF must not require a local text layer')
    monkeypatch.setattr(FileTextExtractor,'extract_text',forbidden)
    agent,calls=agent_for(provider)
    assert agent.run(request([path])).output_text
    assert len(calls)==1

@pytest.mark.parametrize('provider',PROVIDERS)
@pytest.mark.parametrize('with_file',[True,False])
def test_normal_hebrew_and_no_attachment_requests(provider,with_file,tmp_path):
    path=tmp_path/'hebrew.txt';path.write_text('שלום עולם',encoding='utf-8')
    agent,calls=agent_for(provider)
    assert agent.run(request([path] if with_file else [])).output_text
    assert len(calls)==1

def test_window_handles_validation_error_and_clears_old_result(monkeypatch):
    # Exercise the actual handler without initializing settings/keyring or showing a window.
    from appraisal_assistant.ui.main_window import MainWindow, QMessageBox
    class Control:
        def __init__(self,value=''): self.value=value;self.enabled=True
        def text(self): return self.value
        def toPlainText(self): return self.value
        def setEnabled(self,value): self.enabled=value
        def clear(self): self.value=''
        def setVisible(self,value): pass
    messages=[]
    monkeypatch.setattr(QMessageBox,'warning',lambda *args:messages.append(args[-1]))
    def fail(request): raise ValueError('synthetic attachment failure')
    status=[]
    window=SimpleNamespace(address_input=Control('synthetic'),example_input=Control(),additional_request_input=Control(),_selected_section_id=lambda:'environment_description',_selected_provider_id=lambda:'qwen',_example_attachments=[],_additional_request_attachments=[],generate_button=Control(),copy_output_button=Control(),output=Control('old result'),warnings=Control(),_router=SimpleNamespace(run=fail),statusBar=lambda:SimpleNamespace(showMessage=status.append))
    MainWindow._generate(window)
    assert messages==['synthetic attachment failure']
    assert window.output.value=='' and window.generate_button.enabled and not window.copy_output_button.enabled
