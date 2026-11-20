# 다른 AI와 검토하기

이 폴더는 실제 검토 결과를 공유하는 곳이다. 아직 다른 AI의 검토가 완료된 상태가 아니다.

## 가장 빠른 시작

다른 AI에게 저장소 주소와 [초기 검토 요청](2026-11-20-initial-request.md)을 전달한다. 먼저 `AGENTS.md`와 `docs/STATUS.md`를 읽고, 검토한 커밋 SHA를 적게 한다.

- 읽기만 가능한 AI: 아래 요청문을 사용하고, 받은 답을 사용자가 전달하거나 파일로 커밋한다.
- 저장소를 수정할 수 있는 AI: `review/<topic>` 브랜치에서 `TEMPLATE.md`를 복사해 작성하고 이 포크의 `main`으로 PR을 만든다.
- 구현 담당자: 검토 의견을 채택·보류·기각으로 구분하고 이유를 PR 또는 `DECISIONS.md`에 남긴다.

```text
저장소: https://github.com/HyunnJg/SDStudio
AGENTS.md → docs/STATUS.md → docs/DECISIONS.md → docs/ROADMAP.md 순서로 읽어줘.
docs/reviews/2026-11-20-initial-request.md의 질문을 독립적으로 검토해줘.
실제로 읽은 브랜치와 커밋 SHA, 확인한 파일을 먼저 적고,
사실·추론·제안을 구분해 영향이 큰 문제부터 알려줘.
코드는 수정하지 말고 docs/reviews/TEMPLATE.md 형식으로 답해줘.
접근하지 못한 파일이나 실행하지 않은 검증은 명시해줘.
```

의견 파일명 예: `2026-11-20-reviewer-topic.md`. 파일명에 API 키나 개인 계정 정보를 넣지 않는다. 별도 오케스트레이터나 모델 API 연결은 필요하지 않다.
